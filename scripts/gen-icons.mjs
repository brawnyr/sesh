// Generate all Tauri-bundle icon files from the pixel-art source PNGs.
// Uses nearest-neighbor scaling so the pixel art stays crisp at every size.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, "..", "src-tauri", "icons");
const SRC_32 = join(__dirname, "icon-source-32.png");
const SRC_16 = join(__dirname, "icon-source-16.png");

mkdirSync(ICONS_DIR, { recursive: true });

const src32 = readFileSync(SRC_32);
const src16 = readFileSync(SRC_16);

// nearest-neighbor scale, square output
async function nearest(buf, size) {
  return await sharp(buf)
    .resize(size, size, {
      kernel: sharp.kernel.nearest,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
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
    dir.writeUInt16LE(1, base + 4);
    dir.writeUInt16LE(32, base + 6);
    dir.writeUInt32LE(entry.png.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    data.push(entry.png);
    offset += entry.png.length;
  });
  return Buffer.concat([header, dir, ...data]);
}

function makeIcns(pngBuf) {
  const type = Buffer.from("ic08", "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(8 + pngBuf.length, 0);
  const entry = Buffer.concat([type, lenBuf, pngBuf]);
  const magic = Buffer.from("icns", "ascii");
  const totalLen = Buffer.alloc(4);
  totalLen.writeUInt32BE(8 + entry.length, 0);
  return Buffer.concat([magic, totalLen, entry]);
}

// Everything is re-encoded through sharp so PNGs land at 8-bit RGBA (the
// Win98 sources are 4-bit indexed which Tauri's icon decoder rejects).
const png32 = await nearest(src32, 32);
const png128 = await nearest(src32, 128);
const png256 = await nearest(src32, 256);
const png1024 = await nearest(src32, 1024);

writeFileSync(join(ICONS_DIR, "32x32.png"), png32);
writeFileSync(join(ICONS_DIR, "128x128.png"), png128);
writeFileSync(join(ICONS_DIR, "128x128@2x.png"), png256);
writeFileSync(join(ICONS_DIR, "icon-1024.png"), png1024);
console.log("wrote 32x32 / 128x128 / 128x128@2x / icon-1024 PNGs");

// Multi-size ICO. Native 16 for small UI, scaled 32 for the rest.
const ico16 = await nearest(src16, 16);
const ico32 = png32;
const ico64 = await nearest(src32, 64);
const ico128 = png128;
const ico256 = png256;
writeFileSync(
  join(ICONS_DIR, "icon.ico"),
  makeIco([
    { size: 16, png: ico16 },
    { size: 32, png: ico32 },
    { size: 64, png: ico64 },
    { size: 128, png: ico128 },
    { size: 256, png: ico256 },
  ]),
);
console.log("wrote icon.ico (multi-size: 16/32/64/128/256)");

writeFileSync(join(ICONS_DIR, "icon.icns"), makeIcns(png256));
console.log("wrote icon.icns");
