// Turns a PNG into a sticker (white die-cut outline) for the 3D clues.
import { loadImage, fitImage, placeholderElement } from "./util.js";

/** The raw element: the user's PNG, or a placeholder until it exists. */
export async function loadElementSource(marker, index) {
  const img = await loadImage(marker.element);
  return {
    source: img ? fitImage(img, 1024) : placeholderElement(marker.placeholder, `${index + 1}`),
    isPlaceholder: !img,
  };
}

/** Adds a white die-cut outline around the opaque pixels, sticker style. */
export function stickerize(src, outline = 0.035) {
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  const r = Math.round(Math.max(sw, sh) * outline);
  const c = document.createElement("canvas");
  c.width = sw + r * 2;
  c.height = sh + r * 2;
  const g = c.getContext("2d");

  const white = document.createElement("canvas");
  white.width = sw;
  white.height = sh;
  const wg = white.getContext("2d");
  wg.drawImage(src, 0, 0);
  wg.globalCompositeOperation = "source-in";
  wg.fillStyle = "#fff";
  wg.fillRect(0, 0, sw, sh);

  for (let a = 0; a < 32; a++) {
    const t = (a / 32) * Math.PI * 2;
    g.drawImage(white, r + Math.cos(t) * r, r + Math.sin(t) * r);
  }
  g.drawImage(src, r, r);
  return c;
}
