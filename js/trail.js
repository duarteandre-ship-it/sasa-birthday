import * as THREE from "three";
import { dotTexture } from "./util.js";

/**
 * A line of glowing dots on the floor along the shortest walkable path
 * to the current goal, with a pulse that flows towards it.
 */
export class Trail {
  constructor(scene, world) {
    this.world = world;
    this.max = 160;
    this.spacing = 0.32;
    const mat = new THREE.MeshBasicMaterial({
      map: dotTexture(), color: 0xffe0f0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.22).rotateX(-Math.PI / 2), mat, this.max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.points = [];
    this.goal = null;
    this._lastPlan = 0;
    this._dummy = new THREE.Object3D();
    this._col = new THREE.Color();
    this.fade = 0;
  }

  setGoal(goal) {
    this.goal = goal; // {x, z} or null
    this._lastPlan = 0;
  }

  update(now, player) {
    if (!this.goal) {
      this.fade = Math.max(0, this.fade - 0.03);
    } else {
      this.fade = Math.min(1, this.fade + 0.03);
      if (now - this._lastPlan > 400) {
        this._lastPlan = now;
        const path = this.world.findPath(player, this.goal);
        this.points = path ? this._resample(path) : [];
      }
    }
    // drop dots that are right under her feet
    let start = 0;
    while (start < this.points.length && Math.hypot(this.points[start].x - player.x, this.points[start].z - player.z) < 0.6) start++;
    const pts = this.points.slice(start, start + this.max);
    const d = this._dummy;
    const t = now / 1000;
    pts.forEach((p, i) => {
      const wave = 0.5 + 0.5 * Math.sin(i * 0.55 - t * 5); // pulse flowing forward
      const near = Math.min(1, (i + 1) / 4); // fade in close to her
      d.position.set(p.x, 0.1, p.z); // scanned floor is bumpy (±4 cm), stay above it
      d.scale.setScalar(0.7 + wave * 0.6);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      const a = (0.35 + 0.65 * wave) * near * this.fade;
      this._col.setRGB(1 * a, (0.72 + 0.2 * wave) * a, 0.85 * a);
      this.mesh.setColorAt(i, this._col);
    });
    this.mesh.count = pts.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  _resample(path) {
    const out = [];
    let carry = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      let s = carry;
      while (s < len) {
        const k = s / len;
        out.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });
        s += this.spacing;
      }
      carry = s - len;
    }
    return out;
  }
}
