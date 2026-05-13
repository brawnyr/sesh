// Rasterize scripts/icon-source.svg to the PNG/ICO/ICNS bundle Tauri expects.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, "..", "src-tauri", "icons");
const SRC_SVG = join(__dirname, "icon-source.svg");

mkdirSync(ICONS_DIR, { recursive: true });

const svg = readFileSync(SRC_SVG);

async function rasterize(size) {
  return await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function makeIco(entries) {
  // entries: Array<{ size: number, png: Buffer }>
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  const data = [];
  let offset = 6 + 16 * count;
  entries.forEach((entry, i) => {
    const base = i * 16;
    const dim = entry.size >= 256 ? 0 : entry.size;
    dir[base + 0] = dim;
    dir[base + 1] = dim;
    dir[base + 2] = 0;
    dir[base + 3] = 0;
    dir.writeUInt16LE(1, base + 4); // planes
    dir.writeUInt16LE(32, base + 6); // bit count
    dir.writeUInt32LE(entry.png.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    data.push(entry.png);
    offset += entry.png.length;
  });
  return Buffer.concat([header, dir, ...data]);
}

function makeIcns(pngBuf) {
  // Single ic08 (256x256) entry — modern macOS reads this fine.
  const type = Buffer.from("ic08", "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(8 + pngBuf.length, 0);
  const entry = Buffer.concat([type, lenBuf, pngBuf]);
  const magic = Buffer.from("icns", "ascii");
  const totalLen = Buffer.alloc(4);
  totalLen.writeUInt32BE(8 + entry.length, 0);
  return Buffer.concat([magic, totalLen, entry]);
}

const sizes = [
  { name: "32x32.png", size: 32 },
  { name: "128x128.png", size: 128 },
  { name: "128x128@2x.png", size: 256 },
];

const rendered = {};
for (const o of sizes) {
  const buf = await rasterize(o.size);
  writeFileSync(join(ICONS_DIR, o.name), buf);
  rendered[o.size] = buf;
  console.log("wrote", o.name);
}

// ICO with multiple sizes so Windows can pick its own at every UI scale.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoEntries = [];
for (const s of icoSizes) {
  const buf = rendered[s] ?? (await rasterize(s));
  icoEntries.push({ size: s, png: buf });
}
writeFileSync(join(ICONS_DIR, "icon.ico"), makeIco(icoEntries));
console.log("wrote icon.ico (multi-size)");

// ICNS with a 256x256 image
const icns256 = rendered[256] ?? (await rasterize(256));
writeFileSync(join(ICONS_DIR, "icon.icns"), makeIcns(icns256));
console.log("wrote icon.icns");

// High-res master that's useful for store listings / `tauri icon` redoes
const hi = await rasterize(1024);
writeFileSync(join(ICONS_DIR, "icon-1024.png"), hi);
console.log("wrote icon-1024.png");
