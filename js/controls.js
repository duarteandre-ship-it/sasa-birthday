import * as THREE from "three";

/* ── Permissions (must be called from a tap on iPhone) ─────── */
export async function requestSensors() {
  const ask = async (E) => {
    if (E && typeof E.requestPermission === "function") {
      try { return (await E.requestPermission()) === "granted"; } catch { return false; }
    }
    return !!E;
  };
  const [orientation, motion] = await Promise.all([ask(window.DeviceOrientationEvent), ask(window.DeviceMotionEvent)]);
  return { orientation, motion };
}

/* ── On-screen joystick ────────────────────────────────────── */
export class Joystick {
  constructor(el) {
    this.el = el;
    this.knob = el.querySelector(".knob");
    this.x = 0; // right +
    this.y = 0; // forward +
    this.active = false;
    let id = null, cx = 0, cy = 0, R = 1;
    const set = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const m = Math.min(1, d / R);
      const k = m < 0.12 ? 0 : (m - 0.12) / 0.88 / m; // small dead zone in the middle
      this.x = (dx / R) * k;
      this.y = (-dy / R) * k;
    };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      id = e.pointerId;
      el.setPointerCapture(id);
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      R = r.width * 0.36;
      this.active = true;
      el.classList.add("on");
      set(e);
    });
    el.addEventListener("pointermove", (e) => e.pointerId === id && set(e));
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.active = false;
      this.x = this.y = 0;
      this.knob.style.transform = "";
      el.classList.remove("on");
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
}

/* ── Look: phone orientation (with drag to turn), or drag only ── */
const zee = new THREE.Vector3(0, 0, 1);
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const _e = new THREE.Euler(), _q0 = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export class Look {
  constructor(camera, surface) {
    this.camera = camera;
    this.gyro = true; // use the phone's orientation when available
    this.hasGyro = false;
    this.orient = null;
    this.yawOffset = 0; // turning by dragging is added on top of the phone's heading
    this.yaw = 0;
    this.pitch = 0;
    this.target = new THREE.Quaternion();
    this.lastDrag = 0;
    addEventListener("deviceorientation", (e) => {
      if (e.alpha == null && e.beta == null) return;
      this.orient = e;
      this.hasGyro = true;
    });

    let down = null;
    surface.addEventListener("pointerdown", (e) => {
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    });
    addEventListener("pointermove", (e) => {
      if (!down || e.pointerId !== down.id) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      down.moved += Math.abs(dx) + Math.abs(dy);
      down.x = e.clientX;
      down.y = e.clientY;
      const k = 0.0055;
      if (this.usingGyro) this.yawOffset += dx * k;
      else {
        this.yaw += dx * k;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * k, -1.3, 1.3);
      }
    });
    const up = (e) => {
      if (!down || e.pointerId !== down.id) return;
      this.lastDrag = down.moved;
      down = null;
    };
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  }

  get usingGyro() {
    return this.gyro && this.hasGyro;
  }

  /** Make "where the phone points now" equal to `heading` (radians). */
  alignTo(heading) {
    this.yaw = heading;
    this.pitch = 0;
    this._pending = heading; // applied as soon as the phone reports its orientation
    this._tryAlign();
  }

  _tryAlign() {
    if (this._pending == null || !this.usingGyro || !this.orient) return;
    this._deviceQuat(this.target);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.target);
    this.yawOffset = this._pending - Math.atan2(-fwd.x, -fwd.z);
    this._pending = null;
  }

  /** Switching gyro on/off keeps the current view direction. */
  setGyro(on) {
    const h = this.heading();
    this.gyro = on;
    this.alignTo(h);
  }

  heading() {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return Math.atan2(-f.x, -f.z);
  }

  _deviceQuat(out) {
    const d = THREE.MathUtils.DEG2RAD, o = this.orient;
    const screenAngle = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * d;
    _e.set((o.beta || 0) * d, (o.alpha || 0) * d, -(o.gamma || 0) * d, "YXZ");
    out.setFromEuler(_e).multiply(q1).multiply(_q0.setFromAxisAngle(zee, -screenAngle));
    return out;
  }

  update(snap = false) {
    if (this.usingGyro && this.orient) {
      this._tryAlign();
      this._deviceQuat(this.target);
      this.target.premultiply(_qy.setFromAxisAngle(_up, this.yawOffset));
    } else {
      _e.set(this.pitch, this.yaw, 0, "YXZ");
      this.target.setFromEuler(_e);
    }
    if (snap) this.camera.quaternion.copy(this.target);
    else this.camera.quaternion.slerp(this.target, this.usingGyro ? 0.35 : 0.3);
  }
}

/* ── Pedometer: real steps move her forward ────────────────── */
export class Steps {
  constructor(onStep) {
    this.enabled = true;
    this.onStep = onStep;
    this.available = false;
    let smooth = 9.8, mean = 9.8, armed = true, last = 0;
    addEventListener("devicemotion", (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      this.available = true;
      if (!this.enabled) return;
      const mag = Math.hypot(a.x, a.y, a.z);
      smooth += (mag - smooth) * 0.25; // remove jitter
      mean += (mag - mean) * 0.02; // slow baseline (gravity)
      const d = smooth - mean;
      const now = performance.now();
      if (armed && d > 1.25 && now - last > 300) {
        armed = false;
        last = now;
        this.onStep();
      } else if (d < 0.2) armed = true;
    });
  }
}

/* ── Keyboard (desktop testing) ────────────────────────────── */
export class Keys {
  constructor() {
    this.down = new Set();
    addEventListener("keydown", (e) => this.down.add(e.key.toLowerCase()));
    addEventListener("keyup", (e) => this.down.delete(e.key.toLowerCase()));
    addEventListener("blur", () => this.down.clear());
  }
  get x() { return (this.has("d", "arrowright") ? 1 : 0) - (this.has("a", "arrowleft") ? 1 : 0); }
  get y() { return (this.has("w", "arrowup") ? 1 : 0) - (this.has("s", "arrowdown") ? 1 : 0); }
  has(...k) { return k.some((x) => this.down.has(x)); }
}
