import * as THREE from "three";

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutBack = (t, s = 1.7) => {
  const x = t - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Load an image; resolves to null instead of rejecting when it's missing. */
export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function imageTexture(img) {
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Downscale big phone photos so the GPU on a phone doesn't choke. */
export function fitImage(img, maxSide = 1280) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (s >= 1) return img;
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** A die-cut sticker style placeholder for a guide element. */
export function placeholderElement({ emoji = "🎈", color = "#ff5d8f" } = {}, label = "") {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.translate(256, 256);
  // star burst
  g.beginPath();
  const spikes = 14;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? 190 : 240;
    const a = (i / (spikes * 2)) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = "#fff";
  g.fill();
  g.beginPath();
  g.arc(0, 0, 170, 0, Math.PI * 2);
  const grad = g.createRadialGradient(-50, -60, 20, 0, 0, 180);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, shade(color, -0.35));
  g.fillStyle = grad;
  g.fill();
  g.font = "180px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, 0, label ? -10 : 8);
  if (label) {
    g.font = "bold 46px system-ui, sans-serif";
    g.fillStyle = "#fff";
    g.fillText(label, 0, 120);
  }
  return c;
}

/** Placeholder memory photo so the room can be previewed before real photos exist. */
export function placeholderPhoto(i) {
  const c = document.createElement("canvas");
  const portrait = i % 3 === 1;
  c.width = portrait ? 600 : 800;
  c.height = portrait ? 800 : 600;
  const g = c.getContext("2d");
  const hues = [340, 30, 200, 270, 150, 10, 300, 50, 180, 230];
  const h = hues[i % hues.length];
  const grad = g.createLinearGradient(0, 0, c.width, c.height);
  grad.addColorStop(0, `hsl(${h} 80% 72%)`);
  grad.addColorStop(1, `hsl(${(h + 50) % 360} 70% 45%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 18; k++) {
    g.fillStyle = `hsla(${(h + k * 20) % 360} 90% 85% / 0.25)`;
    g.beginPath();
    g.arc(Math.random() * c.width, Math.random() * c.height, 20 + Math.random() * 90, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.font = "bold 72px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(`memory ${i + 1}`, c.width / 2, c.height / 2 - 20);
  g.font = "32px system-ui, sans-serif";
  g.fillText("add your photo", c.width / 2, c.height / 2 + 45);
  return c;
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => clamp(Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt)), 0, 255);
  const r = f(n >> 16), gg = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Soft round sprite used for sparkles / glow. */
let _dot;
export function dotTexture() {
  if (_dot) return _dot;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,240,220,0.8)");
  grad.addColorStop(1, "rgba(255,200,230,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _dot = canvasTexture(c);
  return _dot;
}

export async function fileExists(url) {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}
