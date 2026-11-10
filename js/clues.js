import * as THREE from "three";
import { canvasTexture, dotTexture, easeOutBack, easeInOutCubic, clamp } from "./util.js";
import { loadElementSource, stickerize } from "./card.js";

const _cam = new THREE.Vector3();
let _beamTex;
function beamTexture() {
  if (_beamTex) return _beamTex;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  _beamTex = canvasTexture(c);
  return _beamTex;
}

/**
 * One of her PNGs floating in the corridor as a thick 3D sticker,
 * with a beam of light so it can be spotted from far away.
 */
export async function createClue(def, index) {
  const { source } = await loadElementSource(def, index);
  const sticker = stickerize(source);
  const tex = canvasTexture(sticker);
  const aspect = sticker.width / sticker.height;
  const color = new THREE.Color(def.color || def.placeholder?.color || "#ffd166");

  const root = new THREE.Group();
  root.position.set(def.position[0], 0, def.position[2]);

  const holder = new THREE.Group(); // float + spin
  holder.position.y = 1.3;
  root.add(holder);

  // thick die-cut sticker: stacked alpha-tested layers, darker inside like a cut edge
  const size = 0.55;
  const geo = new THREE.PlaneGeometry(aspect >= 1 ? size : size * aspect, aspect >= 1 ? size / aspect : size);
  const layers = 14, depth = 0.045;
  const body = new THREE.Group();
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const face = i === 0 || i === layers - 1;
    const tone = face ? 1 : 0.55 + 0.25 * Math.sin(t * Math.PI);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(tone, tone, tone) }));
    m.position.z = (t - 0.5) * depth;
    if (i === 0) m.scale.x = -1;
    body.add(m);
  }
  holder.add(body);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(1.3);
  holder.add(glow);

  // beam of light from the floor
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.4, 3.2, 24, 1, true),
    new THREE.MeshBasicMaterial({ map: beamTexture(), color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  );
  beam.position.y = 1.6;
  root.add(beam);

  // pulsing ring on the floor
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  root.add(ring);

  // sparkles orbiting the sticker
  const N = 36;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const seeds = Array.from({ length: N }, () => [Math.random() * 6.28, 0.32 + Math.random() * 0.25, Math.random() - 0.5, 0.5 + Math.random()]);
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ map: dotTexture(), size: 0.05, color: 0xfff1c9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  holder.add(sparks);

  // burst on collection
  const burstGeo = new THREE.BufferGeometry();
  const BN = 90;
  burstGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BN * 3), 3));
  const burstVel = Array.from({ length: BN }, () => new THREE.Vector3().randomDirection().multiplyScalar(1 + Math.random() * 2.5));
  const burst = new THREE.Points(burstGeo, new THREE.PointsMaterial({ map: dotTexture(), size: 0.08, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  burst.frustumCulled = false;
  root.add(burst);

  const seed = Math.random() * 10;
  let state = "idle", t0 = 0;
  const fromPos = new THREE.Vector3(), burstAt = new THREE.Vector3();

  return {
    object: root,
    index,
    def,
    get collected() { return state !== "idle"; },
    pickables: body.children,
    distanceTo(p) { return Math.hypot(p.x - root.position.x, p.z - root.position.z); },

    collect(now) {
      if (state !== "idle") return false;
      state = "flying";
      t0 = now;
      fromPos.copy(holder.position);
      return true;
    },

    update(now, dt, camera) {
      const t = now / 1000 + seed;
      if (state === "idle") {
        holder.position.y = 1.3 + Math.sin(t * 1.6) * 0.06;
        // always turn the clue's face towards her (with a gentle wobble) so it stays readable
        const cp = camera.getWorldPosition(_cam);
        const facing = Math.atan2(cp.x - root.position.x, cp.z - root.position.z);
        body.rotation.y = facing + Math.sin(t * 0.9) * 0.22;
        glow.material.opacity = 0.55 + Math.sin(t * 3) * 0.15;
        const rp = (t * 0.6) % 1;
        ring.scale.setScalar(0.6 + rp * 1.2);
        ring.material.opacity = (1 - rp) * 0.8;
        beam.material.opacity = 0.45 + Math.sin(t * 2) * 0.1;
      } else if (state === "flying") {
        // swoop into her hands: towards a point just in front of the camera
        const k = clamp((now - t0) / 900, 0, 1);
        const e = easeInOutCubic(k);
        const camLocal = root.worldToLocal(
          camera.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.15, -0.6).applyQuaternion(camera.quaternion))
        );
        holder.position.lerpVectors(fromPos, camLocal, e);
        holder.position.y += Math.sin(e * Math.PI) * 0.35;
        body.rotation.y += dt * (6 + 14 * e);
        const s = k < 0.75 ? 1 + easeOutBack(k / 0.75) * 0.3 : 1.3 * (1 - (k - 0.75) / 0.25);
        holder.scale.setScalar(Math.max(0.0001, s));
        beam.material.opacity *= 0.9;
        ring.material.opacity *= 0.9;
        if (k >= 1) {
          state = "burst";
          t0 = now;
          burstAt.copy(holder.position);
          holder.visible = false;
          burst.material.opacity = 1;
        }
      } else if (state === "burst") {
        const k = clamp((now - t0) / 1200, 0, 1);
        const p = burstGeo.attributes.position.array;
        for (let i = 0; i < BN; i++) {
          const v = burstVel[i];
          p[i * 3] = burstAt.x + v.x * k * 0.8;
          p[i * 3 + 1] = burstAt.y + v.y * k * 0.8 - k * k * 0.6;
          p[i * 3 + 2] = burstAt.z + v.z * k * 0.8;
        }
        burstGeo.attributes.position.needsUpdate = true;
        burst.material.opacity = 1 - k;
        beam.material.opacity *= 0.92;
        ring.material.opacity *= 0.92;
        if (k >= 1) { state = "done"; root.visible = false; }
      }

      if (holder.visible) {
        const p = sparkGeo.attributes.position.array;
        for (let i = 0; i < N; i++) {
          const [a0, r, h, sp] = seeds[i];
          const a = a0 + t * sp;
          p[i * 3] = Math.cos(a) * r;
          p[i * 3 + 1] = h * 0.5 + Math.sin(a * 2) * 0.05;
          p[i * 3 + 2] = Math.sin(a) * r;
        }
        sparkGeo.attributes.position.needsUpdate = true;
      }
    },
  };
}
