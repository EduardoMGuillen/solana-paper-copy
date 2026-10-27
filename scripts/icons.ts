/**
 * Render the pixel-chicken logo to PNG for the desktop app (window, tray, installers).
 * No image library: the grid is drawn straight into raw RGBA rows.
 *
 *   npx tsx scripts/icons.ts
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { LOGO_GRID } from "../src/lib/logo-grid";

const COLORS: Record<string, [number, number, number]> = { "#": [0x00, 0xff, 0x41], c: [0xff, 0x3b, 0x3b], b: [0xff, 0xb0, 0x00] };

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Black square, logo centred with a 2-cell margin, like src/app/icon.svg. */
function png(size: number): Buffer {
  const cells = LOGO_GRID.length + 4;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const gx = Math.floor((x * cells) / size) - 2;
      const gy = Math.floor((y * cells) / size) - 2;
      const color = COLORS[LOGO_GRID[gy]?.[gx] ?? ""] ?? [0, 0, 0];
      row.set([...color, 255], 1 + x * 4);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.writeFileSync("desktop/icon.png", png(512));
fs.writeFileSync("desktop/tray.png", png(40));
console.log("desktop/icon.png, desktop/tray.png");
