import * as THREE from "three";
import {
  loadImage, imageTexture, canvasTexture, placeholderPhoto, dotTexture, fitImage,
  easeOutCubic, easeInOutCubic, easeOutBack, clamp,
} from "./util.js";

const BALLOON_COLORS = [0xff5d8f, 0xffd166, 0x7b5cff, 0x4cc9f0, 0xff8fab, 0xf72585, 0x90e0ef, 0xffb703];

/**
 * The memory room inside the scanned C306: photos become thick floating 3D prints
 * in a ring around the middle of the room, with balloons, confetti and a curved banner.
 * `root` sits at eye height in the centre of the room (local y = 0 is eye level,
 * the floor is at -eyeHeight).
 */
export class MemoryRoom {
  constructor({ config, scene, camera }) {
    this.config = config;
    this.roomCfg = config.scenario.room;
    this.eye = config.scenario.eyeHeight;
    this.scene = scene;
    this.camera = camera;
    this.root = new THREE.Group();
    const c = this.roomCfg.center;
    this.root.position.set(c[0], this.eye, c[2]);
    this.scene.add(this.root);
    this.photos = [];
    this.focused = null;
    this.raycaster = new THREE.Raycaster();
    this.enteredAt = -1;

    this.root.add(new THREE.HemisphereLight(0xfff4e8, 0x5a3a70, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 2, 1);
    this.root.add(key);
  }

  async build() {
    await Promise.all([this._buildPhotos(), this._buildBanner()]);
    this._buildBalloons();
    this._buildConfetti();
    this._buildDust();
    this.root.visible = false;
  }

  // ── photos ────────────────────────────────────────────────
  async _buildPhotos() {
    const list = this.config.photos;
    const imgs = await Promise.all(list.map((p) => loadImage(p.src)));
    const n = list.length;
    const twoRows = n > 7;
    const perRow = twoRows ? Math.ceil(n / 2) : n;
    const radius = this.roomCfg.photoRadius || 1.7;

    list.forEach((p, i) => {
      const src = imgs[i] ? fitImage(imgs[i]) : placeholderPhoto(i);
      const tex = imgs[i] ? imageTexture(src) : canvasTexture(src);
      const w0 = src.width || src.naturalWidth;
      const h0 = src.height || src.naturalHeight;
      const aspect = w0 / h0;
      const maxSide = 0.75;
      const w = aspect >= 1 ? maxSide : maxSide * aspect;
      const h = aspect >= 1 ? maxSide / aspect : maxSide;

      const g = new THREE.Group();
      const holder = new THREE.Group(); // for floating / focus animation
      g.add(holder);

      // the "print": a thick mount with a white border, like a photo on foam board
      const border = 0.045;
      const capH = p.caption ? 0.12 : 0;
      const depth = 0.05;
      const mount = new THREE.Mesh(
        new THREE.BoxGeometry(w + border * 2, h + border * 2 + capH, depth),
        new THREE.MeshStandardMaterial({ color: 0xfbf7f2, emissive: 0x8a8580, roughness: 0.6, metalness: 0.0 })
      );
      mount.position.y = -capH / 2;
      holder.add(mount);

      const photo = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
      );
      photo.position.z = depth / 2 + 0.001;
      holder.add(photo);

      if (p.caption) {
        const c = document.createElement("canvas");
        c.width = 1024;
        c.height = Math.round(1024 * (capH / w));
        const cg = c.getContext("2d");
        cg.fillStyle = "#3a2a33";
        cg.font = `600 ${Math.round(c.height * 0.55)}px "Segoe Print","Bradley Hand","Marker Felt",cursive`;
        cg.textAlign = "center";
        cg.textBaseline = "middle";
        cg.fillText(p.caption, c.width / 2, c.height / 2, c.width * 0.94);
        const cap = new THREE.Mesh(
          new THREE.PlaneGeometry(w, capH),
          new THREE.MeshBasicMaterial({ map: canvasTexture(c), transparent: true })
        );
        cap.position.set(0, -h / 2 - border / 2 - capH / 2 + 0.01, depth / 2 + 0.001);
        holder.add(cap);
      }

      // soft glow behind each print so it pops against the real room
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry((w + 0.3) * 1.6, (h + 0.3) * 1.6),
        new THREE.MeshBasicMaterial({
          map: dotTexture(), color: p.portal ? 0x9fe3ff : 0xffc8dd, transparent: true, opacity: 0.35, // portal photos glow blue
          depthWrite: false, blending: THREE.AdditiveBlending,
        })
      );
      glow.position.z = -depth;
      holder.add(glow);

      // placement around her
      const row = twoRows ? i % 2 : 0;
      const col = twoRows ? Math.floor(i / 2) : i;
      const step = (Math.PI * 2) / perRow;
      const angle = col * step + (row ? step / 2 : 0); // 0 = straight ahead
      const y = twoRows ? (row ? -0.5 : 0.28) : -0.05;
      const r = radius + (row ? 0.15 : 0);
      const home = new THREE.Vector3(-Math.sin(angle) * r, y, -Math.cos(angle) * r);

      g.position.copy(home);
      this.root.add(g);
      this.root.updateMatrixWorld(true);
      g.lookAt(this.root.localToWorld(new THREE.Vector3(0, y * 0.6, 0))); // face the middle of the room
      const homeQuat = g.quaternion.clone();

      photo.userData.photo = mount.userData.photo = this.photos.length;
      this.photos.push({
        group: g, holder, home, homeQuat, glow, pickables: [photo, mount], portal: !!p.portal,
        seed: Math.random() * 10, angle, focus: 0,
        size: { w: w + border * 2, h: h + border * 2 + capH },
      });
    });
  }

  // ── banner ────────────────────────────────────────────────
  async _buildBanner() {
    // Sized to fit the narrow horizontal view of a phone held upright.
    const W = 1024, H = 440;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const top = this.config.bannerTop;
    const name = this.config.name;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const family = `ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif`;
    const draw = (text, y, maxSize, fill) => {
      let size = maxSize;
      g.font = `900 ${size}px ${family}`;
      const w = g.measureText(text).width;
      if (w > W * 0.9) size = Math.floor(size * ((W * 0.9) / w));
      g.font = `900 ${size}px ${family}`;
      g.lineJoin = "round";
      g.lineWidth = size * 0.18;
      g.strokeStyle = "rgba(60,10,40,0.85)";
      g.strokeText(text, W / 2, y);
      g.fillStyle = fill;
      g.fillText(text, W / 2, y);
    };
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "#ffd166");
    grad.addColorStop(0.5, "#ffffff");
    grad.addColorStop(1, "#ff8fab");
    draw(top, 110, 110, "#fff7ef");
    draw(`${name}!`, 300, 210, grad);

    const tex = canvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1; // seen from inside the cylinder
    const r = 1.45;
    const width = 0.8;
    const arc = width / r;
    const geo = new THREE.CylinderGeometry(r, r, width * (H / W), 48, 1, true, Math.PI - arc / 2, arc);
    this.banner = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false })
    );
    this.banner.position.y = 0.5;
    this.banner.renderOrder = 5;
    this.root.add(this.banner);
  }

  // ── balloons ──────────────────────────────────────────────
  _buildBalloons() {
    this.balloons = [];
    const geo = new THREE.SphereGeometry(0.16, 32, 24);
    geo.scale(1, 1.18, 1);
    const knotGeo = new THREE.ConeGeometry(0.025, 0.04, 12);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: BALLOON_COLORS[i % BALLOON_COLORS.length],
        roughness: 0.18, metalness: 0.05, emissive: BALLOON_COLORS[i % BALLOON_COLORS.length], emissiveIntensity: 0.12,
      });
      const b = new THREE.Group();
      const ball = new THREE.Mesh(geo, mat);
      const knot = new THREE.Mesh(knotGeo, mat);
      knot.position.y = -0.2;
      const stringGeo = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 12 }, (_, k) => new THREE.Vector3(Math.sin(k * 0.9) * 0.02, -0.22 - k * 0.06, 0))
      );
      const string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
      b.add(ball, knot, string);
      const a = Math.random() * Math.PI * 2;
      const r = 0.7 + Math.random() * 1.9;
      b.userData = { a, r, y: -1.5 + Math.random() * 2.6, speed: 0.12 + Math.random() * 0.15, seed: Math.random() * 10 };
      b.scale.setScalar(0.8 + Math.random() * 0.5);
      this.root.add(b);
      this.balloons.push(b);
    }
  }

  // ── confetti ──────────────────────────────────────────────
  _buildConfetti() {
    const count = 420;
    const geo = new THREE.PlaneGeometry(0.035, 0.018);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false });
    this.confetti = new THREE.InstancedMesh(geo, mat, count);
    this.confettiData = [];
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      color.setHex(BALLOON_COLORS[i % BALLOON_COLORS.length]);
      this.confetti.setColorAt(i, color);
      this.confettiData.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), spin: new THREE.Vector3(), alive: false });
    }
    this.confetti.frustumCulled = false;
    this.root.add(this.confetti);
    this._dummy = new THREE.Object3D();
  }

  _burst(origin, n = 260) {
    let made = 0;
    for (const d of this.confettiData) {
      if (made >= n) break;
      d.p.copy(origin);
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const s = 1.5 + Math.random() * 3.2;
      d.v.set(Math.cos(a) * Math.cos(e) * s, Math.abs(Math.sin(e)) * s + 1.5, Math.sin(a) * Math.cos(e) * s);
      d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      d.spin.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
      d.alive = true;
      made++;
    }
  }

  _rain(d) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.3 + Math.random() * 2.2;
    d.p.set(Math.cos(a) * r, 0.9 + Math.random() * 0.3, Math.sin(a) * r);
    d.v.set(0, -0.3, 0);
    d.alive = true;
  }

  // ── floating dust / sparkles ──────────────────────────────
  _buildDust() {
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 2.3;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = -1.5 + Math.random() * 2.6;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: dotTexture(), size: 0.05, color: 0xffe9c4, transparent: true, opacity: 0.85,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    this.root.add(this.dust);
  }

  // ── lifecycle ─────────────────────────────────────────────
  /** Called the moment she enters C306. `heading` = where she's looking. */
  enter(now, heading) {
    this.enteredAt = now;
    this.root.visible = true;
    this.root.rotation.y = heading; // the banner + first photo appear right in front of her
    this.root.updateMatrixWorld();
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this._burst(this.root.worldToLocal(cam.add(dir.multiplyScalar(1.2))), 300);
    this.photos.forEach((p) => {
      p.group.scale.setScalar(0.0001);
    });
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tap(x, y) {
    if (this.enteredAt < 0) return;
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.photos.flatMap((p) => p.pickables), false);
    const idx = hits.length ? hits[0].object.userData.photo : null;
    if (idx == null || this.focused === idx) this.focused = null;
    else this.focused = idx;
    return idx; // which photo was tapped (null = none)
  }

  update(now, dt) {
    if (this.enteredAt < 0) return;
    const t = (now - this.enteredAt) / 1000;
    this.camera.updateMatrixWorld();
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // banner
    const bannerIn = clamp((t - 0.2) / 1.2, 0, 1);
    this.banner.scale.setScalar(Math.max(0.0001, easeOutBack(bannerIn, 1.4)));
    this.banner.position.y = 0.5 + Math.sin(t * 0.8) * 0.03;

    // photos: spiral out from in front of her, then float
    const invRoot = new THREE.Quaternion().copy(this.root.quaternion).invert();
    const focusDist = 1.0;
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const focusPos = this.root.worldToLocal(camPos.clone().addScaledVector(camDir, focusDist));
    const viewH = 2 * focusDist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const viewW = viewH * this.camera.aspect;
    const focusQuat = new THREE.Quaternion().multiplyQuaternions(invRoot, this.camera.quaternion);
    let gazeBest = null, gazeDot = 0.93;

    this.photos.forEach((p, i) => {
      const delay = 0.6 + i * 0.18;
      const k = clamp((t - delay) / 1.8, 0, 1);
      const e = easeOutCubic(k);
      if (k < 1) {
        // spiral from the centre-front to the home spot
        const start = new THREE.Vector3(0, 0.1, -0.9);
        const spin = (1 - e) * 2.2;
        const mid = p.home.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spin);
        p.group.position.lerpVectors(start, mid, e);
        p.group.scale.setScalar(Math.max(0.0001, easeOutBack(k, 1.3)));
        p.group.quaternion.copy(p.homeQuat);
      } else {
        // focus animation (tap to bring closer)
        const want = this.focused === i ? 1 : 0;
        p.focus += (want - p.focus) * Math.min(1, dt * 6);
        const f = easeInOutCubic(p.focus);
        const bob = new THREE.Vector3(0, Math.sin(t * 0.9 + p.seed) * 0.05, 0);
        p.group.position.lerpVectors(p.home.clone().add(bob), focusPos, f);
        p.group.quaternion.slerpQuaternions(p.homeQuat, focusQuat, f);
        const fit = Math.min(0.88 * viewW / p.size.w, 0.7 * viewH / p.size.h);
        p.group.scale.setScalar(THREE.MathUtils.lerp(1, fit, f));
        p.holder.rotation.y = Math.sin(t * 0.6 + p.seed) * 0.08 * (1 - f);
        p.holder.rotation.z = Math.sin(t * 0.5 + p.seed * 2) * 0.03 * (1 - f);

        // which photo is she looking at?
        const wp = p.group.getWorldPosition(new THREE.Vector3()).sub(camPos).normalize();
        const d = wp.dot(camDir);
        if (d > gazeDot) { gazeDot = d; gazeBest = p; }
      }
      p.glow.material.opacity = p.portal
        ? 0.45 + Math.sin(t * 3 + p.seed) * 0.3 // portal photos pulse to invite a tap
        : 0.25 + Math.sin(t * 1.3 + p.seed) * 0.08;
    });
    if (gazeBest && this.focused == null) {
      gazeBest.glow.material.opacity = 0.6;
      gazeBest.holder.scale.lerp(new THREE.Vector3(1.08, 1.08, 1.08), 0.1);
    }
    this.photos.forEach((p) => { if (p !== gazeBest) p.holder.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1); });

    // balloons drift upward and loop
    for (const b of this.balloons) {
      const u = b.userData;
      u.y += u.speed * dt;
      if (u.y > 1.0) u.y = -1.6;
      const a = u.a + Math.sin(t * 0.2 + u.seed) * 0.15;
      b.position.set(Math.cos(a) * u.r, u.y, Math.sin(a) * u.r);
      b.rotation.z = Math.sin(t * 0.8 + u.seed) * 0.12;
    }

    // confetti physics
    const dm = this._dummy;
    const raining = t > 3;
    this.confettiData.forEach((d, i) => {
      if (!d.alive) {
        if (raining && Math.random() < 0.004) this._rain(d);
        else { dm.position.set(0, -999, 0); dm.updateMatrix(); this.confetti.setMatrixAt(i, dm.matrix); return; }
      }
      d.v.y -= 2.2 * dt;
      d.v.multiplyScalar(1 - Math.min(1, dt * 1.8)); // air drag
      d.v.y = Math.max(d.v.y, -0.55);
      d.p.addScaledVector(d.v, dt);
      d.p.x += Math.sin(now * 0.002 + i) * 0.003;
      d.r.x += d.spin.x * dt; d.r.y += d.spin.y * dt; d.r.z += d.spin.z * dt;
      if (d.p.y < -1.55) d.alive = false;
      dm.position.copy(d.p);
      dm.rotation.copy(d.r);
      dm.updateMatrix();
      this.confetti.setMatrixAt(i, dm.matrix);
    });
    this.confetti.instanceMatrix.needsUpdate = true;

    // dust twinkle
    this.dust.rotation.y = t * 0.01;
    this.dust.material.opacity = 0.6 + Math.sin(t * 2) * 0.2;
  }
}
