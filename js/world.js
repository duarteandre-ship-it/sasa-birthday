import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/**
 * The scanned corridor + C306, plus a top-down "walk map" of where she can stand
 * (generated from the scan: floor present, nothing between knee and head height).
 * Gives collision (slide along walls) and shortest paths for the guiding trail.
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.model = null;
    this.materials = [];
  }

  async load(scenario, onProgress = () => {}) {
    const lite = new URLSearchParams(location.search).has("lite") || (navigator.deviceMemory && navigator.deviceMemory <= 3);
    const url = lite && scenario.modelLite ? scenario.modelLite : scenario.model;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [gltf] = await Promise.all([
      loader.loadAsync(url, (e) => e.total && onProgress(e.loaded / e.total)),
      this._loadWalkmap(scenario.walkmap),
    ]);
    this.model = gltf.scene;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false; // one big mesh: culling never helps
        const m = o.material;
        if (m.map) m.map.anisotropy = 4;
        this.materials.push(m);
      }
    });
    this.scene.add(this.model);
    this.box = new THREE.Box3().setFromObject(this.model);
  }

  /**
   * Remove the part of the scan inside a box (world metres: [x0,x1, y0,y1, z0,z1]),
   * e.g. the scanned armchair, so something else can stand in its place.
   */
  cutBox([x0, x1, y0, y1, z0, z1]) {
    const v = new THREE.Vector3(), c = new THREE.Vector3();
    let removed = 0;
    this.model.updateMatrixWorld(true);
    this.model.traverse((o) => {
      if (!o.isMesh || !o.geometry.index) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index.array;
      const keep = [];
      for (let t = 0; t < idx.length; t += 3) {
        c.set(0, 0, 0);
        for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, idx[t + k]).applyMatrix4(o.matrixWorld));
        c.multiplyScalar(1 / 3);
        if (c.x > x0 && c.x < x1 && c.y > y0 && c.y < y1 && c.z > z0 && c.z < z1) { removed++; continue; }
        keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      o.geometry.setIndex(keep);
    });
    return removed;
  }

  /** Ghost the scan over the live camera ("reality mix"). */
  setGhost(on) {
    for (const m of this.materials) {
      m.transparent = on;
      m.opacity = on ? 0.32 : 1;
      m.needsUpdate = true;
    }
  }

  async _loadWalkmap(base) {
    const [meta, img] = await Promise.all([
      fetch(base + ".json").then((r) => r.json()),
      new Promise((ok, fail) => {
        const im = new Image();
        im.onload = () => ok(im);
        im.onerror = fail;
        im.src = base + ".png";
      }),
    ]);
    const c = document.createElement("canvas");
    c.width = meta.width;
    c.height = meta.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    this.grid = new Uint8Array(meta.width * meta.height);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = px[i * 4] > 127 ? 1 : 0;
    this.meta = meta;
    this.walkmapImage = img;
  }

  cellOf(x, z) {
    const { originX, originZ, cell, width, height } = this.meta;
    const i = Math.floor((x - originX) / cell), j = Math.floor((z - originZ) / cell);
    return i >= 0 && j >= 0 && i < width && j < height ? j * width + i : -1;
  }

  walkable(x, z) {
    const k = this.cellOf(x, z);
    return k >= 0 && this.grid[k] === 1;
  }

  /** Move from (pos.x, pos.z) by (dx, dz), sliding along walls. Mutates pos. */
  move(pos, dx, dz) {
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (this.meta.cell * 0.5)));
    const sx = dx / steps, sz = dz / steps;
    for (let s = 0; s < steps; s++) {
      if (this.walkable(pos.x + sx, pos.z + sz)) { pos.x += sx; pos.z += sz; }
      else if (this.walkable(pos.x + sx, pos.z)) pos.x += sx;
      else if (this.walkable(pos.x, pos.z + sz)) pos.z += sz;
      else break;
    }
    return pos;
  }

  /** Closest walkable point (for bad config values). */
  nearestWalkable(x, z) {
    if (this.walkable(x, z)) return { x, z };
    const { cell } = this.meta;
    for (let r = cell; r < 5; r += cell) {
      for (let a = 0; a < 32; a++) {
        const t = (a / 32) * Math.PI * 2;
        const px = x + Math.cos(t) * r, pz = z + Math.sin(t) * r;
        if (this.walkable(px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  /**
   * Shortest walkable path (BFS on a 2×-coarser grid, then smoothed).
   * Returns an array of {x, z} from `from` to `to`, or null.
   */
  findPath(from, to) {
    const { originX, originZ, cell, width, height } = this.meta;
    const S = 2; // coarse factor
    const W = Math.ceil(width / S), H = Math.ceil(height / S);
    if (!this._coarse) {
      this._coarse = new Uint8Array(W * H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const k = (j * S) * width + i * S;
        this._coarse[j * W + i] = this.grid[k] && (this.grid[k + 1] ?? 0) ? 1 : 0;
      }
    }
    const C = this._coarse;
    const toCell = (p) => {
      const i = Math.floor((p.x - originX) / (cell * S)), j = Math.floor((p.z - originZ) / (cell * S));
      return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
    };
    const snap = (k) => {
      if (k >= 0 && C[k]) return k;
      // nearest open coarse cell
      const i0 = k % W, j0 = (k / W) | 0;
      for (let r = 1; r < 20; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const i = i0 + di, j = j0 + dj;
        if (i >= 0 && j >= 0 && i < W && j < H && C[j * W + i]) return j * W + i;
      }
      return -1;
    };
    const a = snap(toCell(from)), b = snap(toCell(to));
    if (a < 0 || b < 0) return null;
    const prev = new Int32Array(W * H).fill(-1);
    prev[a] = a;
    const q = new Int32Array(W * H);
    let head = 0, tail = 0;
    q[tail++] = a;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (head < tail) {
      const k = q[head++];
      if (k === b) break;
      const i = k % W, j = (k / W) | 0;
      for (const [di, dj] of dirs) {
        const ii = i + di, jj = j + dj, kk = jj * W + ii;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H || !C[kk] || prev[kk] !== -1) continue;
        if (di && dj && (!C[j * W + ii] || !C[jj * W + i])) continue; // no corner cutting
        prev[kk] = k;
        q[tail++] = kk;
      }
    }
    if (prev[b] === -1) return null;
    const cells = [];
    for (let k = b; k !== a; k = prev[k]) cells.push(k);
    cells.push(a);
    cells.reverse();
    const pts = cells.map((k) => ({ x: originX + ((k % W) + 0.5) * cell * S, z: originZ + (((k / W) | 0) + 0.5) * cell * S }));
    pts[pts.length - 1] = { x: to.x, z: to.z };
    // string-pull: drop points while there's a straight walkable line
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this._lineWalkable(pts[anchor], pts[i])) { out.push(pts[i - 1]); anchor = i - 1; }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  _lineWalkable(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(d / (this.meta.cell * 1.5));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!this.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }
}
