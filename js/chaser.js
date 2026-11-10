import * as THREE from "three";
import { loadImage, imageTexture, canvasTexture } from "./util.js";

/**
 * A flat photo that hunts her down the street (Garry's-Mod-nextbot style):
 * it appears far down the road, waits a moment, then drifts towards her very slowly,
 * always turned to face her. `update()` returns "caught" when it touches her.
 */
export class Chaser {
  constructor({ scene, cfg }) {
    this.cfg = {
      image: "assets/chaser.jpg",
      start: [-3.2, 0, -38],
      delay: 4, // seconds before it starts moving
      speed: 0.45, // metres per second (very slow)
      height: 1.7, // metres tall
      catchRadius: 0.8,
      ...cfg,
    };
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.active = false;
    this.startDist = 1;
  }

  async load() {
    const img = await loadImage(this.cfg.image);
    const src = img || placeholderFace();
    this.imageUrl = img ? this.cfg.image : src.toDataURL("image/jpeg", 0.9);
    const tex = img ? imageTexture(img) : canvasTexture(src);
    const aspect = (src.naturalWidth || src.width) / (src.naturalHeight || src.height);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false }));
    this.sprite.scale.set(this.cfg.height * aspect, this.cfg.height, 1);
    this.sprite.renderOrder = 10; // always drawn over the street, so it can be spotted from far away
    this.sprite.material.depthTest = false;
    this.group.add(this.sprite);
  }

  /** Put it back at the far end of the street, waiting. */
  reset(now) {
    const [x, , z] = this.cfg.start;
    this.group.position.set(x, 0, z);
    this.group.visible = true;
    this.active = true;
    this.t0 = now;
    this._measure = true; // remember how far away it started (for the music's tension)
  }

  hide() {
    this.group.visible = false;
    this.active = false;
  }

  /** 0 when it's at the start, 1 when it's touching her. */
  closeness(player) {
    const d = Math.hypot(player.x - this.group.position.x, player.z - this.group.position.z);
    return Math.min(1, Math.max(0, 1 - d / this.startDist));
  }

  update(now, dt, player) {
    if (!this.active || !this.sprite) return null;
    const p = this.group.position;
    const dx = player.x - p.x, dz = player.z - p.z;
    const d = Math.hypot(dx, dz);
    if (this._measure) { this.startDist = Math.max(d, 1); this._measure = false; }
    const t = (now - this.t0) / 1000;
    if (t > this.cfg.delay && d > 0.001) {
      const step = Math.min(d, this.cfg.speed * dt);
      p.x += (dx / d) * step;
      p.z += (dz / d) * step;
    }
    // unsettling float: a slow bob and a tiny nervous jitter
    this.sprite.position.y = this.cfg.height / 2 + 0.25 + Math.sin(t * 1.3) * 0.06 + (Math.random() - 0.5) * 0.01;
    this.sprite.material.rotation = Math.sin(t * 0.7) * 0.04;
    return d < this.cfg.catchRadius ? "caught" : null;
  }
}

/** The chaser's face: pale, staring (used whenever `image` is null or missing). */
function placeholderFace() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#f2efe9";
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = "#e8c9b0";
  g.beginPath();
  g.ellipse(256, 270, 150, 195, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#5a4636";
  g.beginPath();
  g.ellipse(256, 150, 175, 110, 0, Math.PI, 0);
  g.fill();
  for (const x of [196, 316]) {
    g.fillStyle = "#fff";
    g.beginPath();
    g.ellipse(x, 255, 34, 22, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#3d6e8f";
    g.beginPath();
    g.arc(x, 255, 15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#000";
    g.beginPath();
    g.arc(x, 255, 6, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "#a35d5d";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(206, 375);
  g.quadraticCurveTo(256, 382, 306, 375);
  g.stroke();
  return c;
}
