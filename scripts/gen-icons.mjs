// Generates simple solid-color icon files for the Tauri bundler so dev/build
// don't fail before we drop in real artwork.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, "..", "src-tauri", "icons");
mkdirSync(ICONS_DIR, { recursive: true });

// warm color matching the drift shader
const COLOR = [255, 185, 118, 255];

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size, [r, g, b, a]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + size * 4;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const o = rowStart + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeIco(pngBuf, size) {
  // Single-image ICO containing a PNG payload
  const dim = size >= 256 ? 0 : size;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = dim;
  entry[1] = dim;
  entry[2] = 0; // color count
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12); // offset = header + entry
  return Buffer.concat([header, entry, pngBuf]);
}

function makeIcns(pngBuf) {
  // Minimal ICNS with one ic07 (128x128 PNG) entry
  const type = Buffer.from("ic07", "ascii");
  const entryLen = Buffer.alloc(4);
  entryLen.writeUInt32BE(8 + pngBuf.length, 0);
  const entry = Buffer.concat([type, entryLen, pngBuf]);
  const magic = Buffer.from("icns", "ascii");
  const totalLen = Buffer.alloc(4);
  totalLen.writeUInt32BE(8 + entry.length, 0);
  return Buffer.concat([magic, totalLen, entry]);
}

const outputs = [
  { name: "32x32.png", size: 32 },
  { name: "128x128.png", size: 128 },
  { name: "128x128@2x.png", size: 256 },
];

for (const o of outputs) {
  const png = makePng(o.size, COLOR);
  writeFileSync(join(ICONS_DIR, o.name), png);
  console.log("wrote", o.name);
}

const ico32Png = makePng(32, COLOR);
writeFileSync(join(ICONS_DIR, "icon.ico"), makeIco(ico32Png, 32));
console.log("wrote icon.ico");

const icns128Png = makePng(128, COLOR);
writeFileSync(join(ICONS_DIR, "icon.icns"), makeIcns(icns128Png));
console.log("wrote icon.icns");
