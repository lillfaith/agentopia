/**
 * Procedural textures, drawn once on a canvas and cached. No image files ship
 * with the theme, so it stays small and fully original. Most are near-white so
 * a material's `color` tints them (one roof-tile texture serves every roof colour).
 */
import * as THREE from "three";
import { seeded } from "./layout";

const cache = new Map<string, THREE.Texture>();

function make(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, opts: { repeat?: boolean; srgb?: boolean } = {}): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  draw(g, size);
  const tex = new THREE.CanvasTexture(canvas);
  if (opts.repeat !== false) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

function speckle(g: CanvasRenderingContext2D, s: number, n: number, colors: string[], r: [number, number], seed: number) {
  const rand = seeded(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rand() * colors.length)];
    g.globalAlpha = 0.25 + rand() * 0.5;
    g.beginPath();
    g.arc(rand() * s, rand() * s, r[0] + rand() * (r[1] - r[0]), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Soft mottled lawn with tiny blades. Tinted by material colour (white = as drawn). */
export const grassTexture = () =>
  make("grass", 256, (g, s) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, s, s);
    speckle(g, s, 260, ["#e6f2df", "#f4fbef", "#dcebd4"], [6, 18], 3);
    const rand = seeded(5);
    g.lineWidth = 1.2;
    for (let i = 0; i < 900; i++) {
      const x = rand() * s;
      const y = rand() * s;
      g.strokeStyle = rand() < 0.5 ? "rgba(150,190,140,0.35)" : "rgba(255,255,255,0.6)";
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 4);
      g.stroke();
    }
  });

export const sandTexture = () =>
  make("sand", 256, (g, s) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, s, s);
    speckle(g, s, 1400, ["#efe2cc", "#fff8ec", "#e4d2b5"], [0.6, 1.8], 9);
  });

/** Soft ripples for the sea: near-white with faint wavelets, scrolled over time. */
export const waterTexture = () =>
  make("water", 256, (g, s) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, s, s);
    const rand = seeded(71);
    g.lineCap = "round";
    for (let i = 0; i < 140; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const w = 10 + rand() * 26;
      g.strokeStyle = rand() < 0.55 ? "rgba(150,190,205,0.35)" : "rgba(255,255,255,0.9)";
      g.lineWidth = 1.5 + rand() * 1.5;
      g.beginPath();
      g.moveTo(x - w / 2, y);
      g.quadraticCurveTo(x, y - 3 - rand() * 3, x + w / 2, y);
      g.stroke();
    }
  });

/** Lime plaster: near-white with soft blotches. */
export const plasterTexture = () =>
  make("plaster", 256, (g, s) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, s, s);
    speckle(g, s, 160, ["#f1ece6", "#faf7f3", "#ebe4dc"], [8, 26], 21);
    speckle(g, s, 600, ["#e8e0d6"], [0.5, 1.2], 22);
  });

/** Irregular fieldstone with mortar. */
export const stoneTexture = () =>
  make("stone", 256, (g, s) => {
    g.fillStyle = "#c9c1bb";
    g.fillRect(0, 0, s, s);
    const rand = seeded(31);
    const rows = 6;
    const h = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -h * 0.4 : 0;
      while (x < s) {
        const w = h * (0.9 + rand() * 0.9);
        const v = 225 + Math.floor(rand() * 28);
        g.fillStyle = `rgb(${v},${v - 6},${v - 10})`;
        roundRect(g, x + 3, r * h + 3, w - 6, h - 6, 10);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.35)";
        roundRect(g, x + 6, r * h + 5, w - 14, (h - 10) * 0.35, 8);
        g.fill();
        x += w;
      }
    }
  });

export const brickTexture = () =>
  make("brick", 256, (g, s) => {
    g.fillStyle = "#e9dcd2";
    g.fillRect(0, 0, s, s);
    const rand = seeded(41);
    const rows = 8;
    const h = s / rows;
    const w = s / 4;
    for (let r = 0; r < rows; r++) {
      for (let c = -1; c < 5; c++) {
        const x = c * w + (r % 2 ? w / 2 : 0);
        const v = 238 + Math.floor(rand() * 17);
        g.fillStyle = `rgb(${v},${v - 14},${v - 18})`;
        roundRect(g, x + 2, r * h + 2, w - 4, h - 4, 4);
        g.fill();
      }
    }
  });

/** Overlapping scalloped roof tiles, shaded so any tint reads as clay or slate. */
export const roofTileTexture = () =>
  make("roof", 256, (g, s) => {
    g.fillStyle = "#b9b0ad";
    g.fillRect(0, 0, s, s);
    const rows = 4;
    const cols = 4;
    const h = s / rows;
    const w = s / cols;
    const rand = seeded(51);
    for (let r = rows; r >= -1; r--) {
      for (let c = -1; c <= cols; c++) {
        const x = c * w + (r % 2 ? w / 2 : 0);
        const y = r * h;
        const v = 236 + Math.floor(rand() * 19);
        const grad = g.createLinearGradient(0, y, 0, y + h * 1.25);
        grad.addColorStop(0, `rgb(${v},${v},${v})`);
        grad.addColorStop(0.75, `rgb(${v - 16},${v - 18},${v - 20})`);
        grad.addColorStop(1, `rgb(${v - 70},${v - 74},${v - 78})`);
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(x + 2, y);
        g.lineTo(x + w - 2, y);
        g.lineTo(x + w - 2, y + h * 0.75);
        g.quadraticCurveTo(x + w / 2, y + h * 1.35, x + 2, y + h * 0.75);
        g.closePath();
        g.fill();
      }
    }
  });

export const woodTexture = () =>
  make("wood", 256, (g, s) => {
    g.fillStyle = "#f4ebe4";
    g.fillRect(0, 0, s, s);
    const rand = seeded(61);
    const planks = 4;
    const w = s / planks;
    for (let p = 0; p < planks; p++) {
      const v = 236 + Math.floor(rand() * 19);
      g.fillStyle = `rgb(${v},${v - 8},${v - 14})`;
      g.fillRect(p * w + 2, 0, w - 4, s);
      g.strokeStyle = "rgba(160,120,100,0.18)";
      g.lineWidth = 1.5;
      for (let k = 0; k < 5; k++) {
        const x = p * w + 6 + rand() * (w - 12);
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + 4, s * 0.3, x - 4, s * 0.6, x + 2, s);
        g.stroke();
      }
    }
  });

/** Pink gingham for the picnic blanket. */
export const ginghamTexture = () =>
  make("gingham", 128, (g, s) => {
    g.fillStyle = "#fff7fa";
    g.fillRect(0, 0, s, s);
    const n = 8;
    const w = s / n;
    g.fillStyle = "rgba(255,130,170,0.45)";
    for (let i = 0; i < n; i += 2) {
      g.fillRect(i * w, 0, w, s);
      g.fillRect(0, i * w, s, w);
    }
  });

/** Soft radial falloff, used for lamp light pools (additive) and contact shadows. */
export const radialTexture = () =>
  make(
    "radial",
    128,
    (g, s) => {
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.45, "rgba(255,255,255,0.45)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    },
    { repeat: false, srgb: false },
  );

/** Painted wooden sign with an icon and the building's name. */
export function signTexture(text: string, icon: string, color: string): THREE.Texture {
  return make(
    `sign:${text}:${icon}:${color}`,
    512,
    (g, s) => {
      g.clearRect(0, 0, s, s);
      const h = s / 2;
      g.fillStyle = "#8a5a44";
      roundRect(g, 0, h / 2 - 8, s, h + 16, 34);
      g.fill();
      g.fillStyle = color;
      roundRect(g, 10, h / 2, s - 20, h, 28);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.35)";
      roundRect(g, 18, h / 2 + 8, s - 36, h * 0.3, 20);
      g.fill();
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "88px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
      g.fillText(icon, s / 2, h / 2 + h * 0.36);
      let size = 64;
      g.font = `900 ${size}px Nunito, ui-rounded, system-ui, sans-serif`;
      while (g.measureText(text).width > s - 60 && size > 28) g.font = `900 ${(size -= 4)}px Nunito, ui-rounded, system-ui, sans-serif`;
      g.fillStyle = "#4a3b5c";
      g.fillText(text, s / 2, h / 2 + h * 0.76);
    },
    { repeat: false },
  );
}

/** A poster or painting for walls: soft shapes on paper. */
export function posterTexture(seed: number, palette: string[]): THREE.Texture {
  return make(
    `poster:${seed}:${palette.join()}`,
    128,
    (g, s) => {
      const rand = seeded(seed);
      g.fillStyle = "#fffaf2";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 5; i++) {
        g.fillStyle = palette[i % palette.length];
        g.globalAlpha = 0.85;
        g.beginPath();
        g.arc(rand() * s, rand() * s, 12 + rand() * 30, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.fillStyle = "#4a3b5c";
      g.fillRect(s * 0.15, s * 0.8, s * 0.7, 6);
      g.fillRect(s * 0.25, s * 0.88, s * 0.5, 5);
      g.strokeStyle = "#e7d7c9";
      g.lineWidth = 8;
      g.strokeRect(0, 0, s, s);
    },
    { repeat: false },
  );
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Scale a geometry's UVs so a repeating texture tiles every `unit` world units on each face of a box. */
export function boxWithWorldUV(w: number, h: number, d: number, unit: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / unit, (uv.getY(i) * dims[f][1]) / unit);
    }
  }
  uv.needsUpdate = true;
  return g;
}
