import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import fsp from 'node:fs/promises';
import { decodeBlp, decodeTga, encodePng, toPng } from './icon-pack.mjs';
import { createJournal } from './journal.mjs';

// BLP2 file: header, palette, one mip.
const blp = ({ compression, alphaDepth = 0, alphaType = 0, width, height, data, palette = [] }) => {
  const head = Buffer.alloc(148 + 1024);
  head.write('BLP2', 0, 'ascii');
  head.writeUInt32LE(1, 4);
  head[8] = compression;
  head[9] = alphaDepth;
  head[10] = alphaType;
  head.writeUInt32LE(width, 12);
  head.writeUInt32LE(height, 16);
  head.writeUInt32LE(148 + 1024, 20);
  head.writeUInt32LE(data.length, 84);
  palette.forEach(([r, g, b], i) => {
    head[148 + i * 4] = b;
    head[148 + i * 4 + 1] = g;
    head[148 + i * 4 + 2] = r;
  });
  return Buffer.concat([head, Buffer.from(data)]);
};
const px = (img, x, y) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

// Reads back our own PNGs (filter 0 rows only).
const readPng = (png) => {
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  let at = 8;
  const idat = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  return { width, height, rgba };
};

test('BLP: DXT1, DXT5 and palette images', () => {
  // DXT1: red and blue end points; pixel 1 picks blue, the rest red.
  const dxt1 = blp({ compression: 2, width: 4, height: 4, data: [0x00, 0xf8, 0x1f, 0x00, 0b0100, 0, 0, 0] });
  const a = decodeBlp(dxt1);
  assert.deepEqual(px(a, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(a, 1, 0), [0, 0, 255, 255]);
  assert.deepEqual(px(a, 3, 3), [255, 0, 0, 255]);

  // DXT5: alpha 255 / 0 end points; pixel 1 takes the second.
  const dxt5 = blp({
    compression: 2,
    alphaDepth: 8,
    alphaType: 7,
    width: 4,
    height: 4,
    data: [255, 0, 0b001000, 0, 0, 0, 0, 0, 0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0],
  });
  const b = decodeBlp(dxt5);
  assert.deepEqual(px(b, 0, 0), [255, 0, 0, 255]);
  assert.equal(px(b, 1, 0)[3], 0);

  // Palette with 8-bit alpha.
  const pal = blp({
    compression: 1,
    alphaDepth: 8,
    width: 2,
    height: 2,
    palette: [[0, 255, 0], [255, 255, 255]],
    data: [0, 1, 1, 0, 255, 128, 0, 255],
  });
  const c = decodeBlp(pal);
  assert.deepEqual(px(c, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(px(c, 1, 0), [255, 255, 255, 128]);
  assert.deepEqual(px(c, 0, 1), [255, 255, 255, 0]);

  assert.equal(decodeBlp(Buffer.from('not a blp')), null);
  // PNG round trip.
  assert.deepEqual(readPng(encodePng(c)), { width: 2, height: 2, rgba: c.rgba });
});

test('TGA: bottom-up raw and RLE', () => {
  const head = (type) => {
    const h = Buffer.alloc(18);
    h[2] = type;
    h.writeUInt16LE(2, 12);
    h.writeUInt16LE(1, 14);
    h[16] = 32;
    return h;
  };
  const raw = Buffer.concat([head(2), Buffer.from([0, 0, 255, 255, 255, 0, 0, 128])]);
  assert.deepEqual([...decodeTga(raw).rgba], [255, 0, 0, 255, 0, 0, 255, 128]);
  const rle = Buffer.concat([head(10), Buffer.from([0x81, 0, 255, 0, 200])]);
  assert.deepEqual([...decodeTga(rle).rgba], [0, 255, 0, 200, 0, 255, 0, 200]);
  assert.ok(toPng(raw, 'tga'));
});

test('icon pack folder: BLP files in any layout, converted once', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-'));
  const pack = await fsp.mkdtemp(path.join(os.tmpdir(), 'pack-'));
  await fsp.mkdir(path.join(pack, 'Interface', 'ICONS'), { recursive: true });
  const file = path.join(pack, 'Interface', 'ICONS', 'Spell_Holy_Renew.blp');
  await fsp.writeFile(file, blp({ compression: 2, width: 4, height: 4, data: [0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0] }));
  const journal = createJournal({
    storage,
    env: { GUILD_CLOUD_ICON_DIR: pack },
    fetchImpl: () => assert.fail('no downloads'),
  });
  const found = await journal.icon('spell_holy_renew');
  assert.equal(found.type, 'image/png');
  assert.deepEqual(px(readPng(found.bytes), 2, 2), [255, 0, 0, 255]);
  await fsp.rm(file);
  assert.equal((await journal.icon('spell_holy_renew')).type, 'image/png', 'kept as PNG');
});
