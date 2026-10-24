// Game icon files to PNG, for serving an icon pack to the app.
//
// Icon packs made for the game (Clean Icons - Mechagnome Edition and the
// like) ship as the game's own formats: BLP (BLP2: palette, DXT1/3/5 or
// raw BGRA) or TGA. Browsers show neither, so the server turns an icon into
// a PNG the first time it's asked for and keeps the PNG.

import zlib from 'node:zlib';

// ---- PNG ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** RGBA pixels (top row first) to a PNG file. */
export const encodePng = ({ width, height, rgba }) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ---- BLP2 --------------------------------------------------------------

const rgb565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31].map(Math.round);

/** One DXT colour block (8 bytes) to 16 RGBA pixels. */
const colorBlock = (buf, at, alwaysFour) => {
  const c0 = buf.readUInt16LE(at);
  const c1 = buf.readUInt16LE(at + 2);
  const a = rgb565(c0);
  const b = rgb565(c1);
  const palette =
    alwaysFour || c0 > c1
      ? [
          [...a, 255],
          [...b, 255],
          a.map((v, i) => Math.round((2 * v + b[i]) / 3)).concat(255),
          a.map((v, i) => Math.round((v + 2 * b[i]) / 3)).concat(255),
        ]
      : [[...a, 255], [...b, 255], a.map((v, i) => Math.round((v + b[i]) / 2)).concat(255), [0, 0, 0, 0]];
  const bits = buf.readUInt32LE(at + 4);
  const out = [];
  for (let i = 0; i < 16; i += 1) out.push(palette[(bits >>> (2 * i)) & 3]);
  return out;
};

const dxt = (buf, at, width, height, alphaType) => {
  const rgba = new Uint8Array(width * height * 4);
  const blockSize = alphaType === 0 ? 8 : 16;
  const bw = Math.max(1, Math.ceil(width / 4));
  const bh = Math.max(1, Math.ceil(height / 4));
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      const block = at + (by * bw + bx) * blockSize;
      if (block + blockSize > buf.length) return rgba;
      let alpha = null;
      if (alphaType === 1) {
        // DXT3: 4 bits of alpha per pixel.
        alpha = [];
        for (let i = 0; i < 16; i += 1) {
          const nibble = (buf[block + (i >> 1)] >> ((i & 1) * 4)) & 15;
          alpha.push(nibble * 17);
        }
      } else if (alphaType === 7) {
        // DXT5: two end points and 3-bit indices.
        const a0 = buf[block];
        const a1 = buf[block + 1];
        const levels = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i += 1) levels.push(Math.round(((7 - i) * a0 + i * a1) / 7));
        else {
          for (let i = 1; i < 5; i += 1) levels.push(Math.round(((5 - i) * a0 + i * a1) / 5));
          levels.push(0, 255);
        }
        let bits = 0n;
        for (let i = 0; i < 6; i += 1) bits |= BigInt(buf[block + 2 + i]) << BigInt(8 * i);
        alpha = [];
        for (let i = 0; i < 16; i += 1) alpha.push(levels[Number((bits >> BigInt(3 * i)) & 7n)]);
      }
      const colors = colorBlock(buf, block + (alphaType === 0 ? 0 : 8), alphaType !== 0);
      for (let i = 0; i < 16; i += 1) {
        const x = bx * 4 + (i & 3);
        const y = by * 4 + (i >> 2);
        if (x >= width || y >= height) continue;
        const o = (y * width + x) * 4;
        const c = colors[i];
        rgba[o] = c[0];
        rgba[o + 1] = c[1];
        rgba[o + 2] = c[2];
        rgba[o + 3] = alpha ? alpha[i] : c[3];
      }
    }
  }
  return rgba;
};

/** A BLP2 file's full-size image as RGBA, or null if it isn't one we read. */
export const decodeBlp = (buf) => {
  if (buf.length < 148 || buf.toString('ascii', 0, 4) !== 'BLP2') return null;
  const compression = buf[8];
  const alphaDepth = buf[9];
  const alphaType = buf[10];
  const width = buf.readUInt32LE(12);
  const height = buf.readUInt32LE(16);
  const offset = buf.readUInt32LE(20);
  const size = buf.readUInt32LE(20 + 64);
  if (!width || !height || width > 4096 || height > 4096 || offset + Math.min(size, 1) > buf.length) return null;
  const n = width * height;
  if (compression === 2) return { width, height, rgba: dxt(buf, offset, width, height, alphaType) };
  const rgba = new Uint8Array(n * 4);
  if (compression === 3) {
    // Raw BGRA.
    for (let i = 0; i < n && offset + i * 4 + 3 < buf.length; i += 1) {
      rgba[i * 4] = buf[offset + i * 4 + 2];
      rgba[i * 4 + 1] = buf[offset + i * 4 + 1];
      rgba[i * 4 + 2] = buf[offset + i * 4];
      rgba[i * 4 + 3] = buf[offset + i * 4 + 3];
    }
    return { width, height, rgba };
  }
  if (compression === 1) {
    // 256-colour palette (BGRA) after the header, then indices, then alpha.
    const palette = 148;
    for (let i = 0; i < n && offset + i < buf.length; i += 1) {
      const p = palette + buf[offset + i] * 4;
      rgba[i * 4] = buf[p + 2];
      rgba[i * 4 + 1] = buf[p + 1];
      rgba[i * 4 + 2] = buf[p];
      let a = 255;
      const at = offset + n;
      if (alphaDepth === 8) a = buf[at + i] ?? 255;
      else if (alphaDepth === 4) a = (((buf[at + (i >> 1)] ?? 255) >> ((i & 1) * 4)) & 15) * 17;
      else if (alphaDepth === 1) a = (((buf[at + (i >> 3)] ?? 255) >> (i & 7)) & 1) * 255;
      rgba[i * 4 + 3] = a;
    }
    return { width, height, rgba };
  }
  return null;
};

// ---- TGA ---------------------------------------------------------------

/** A true-colour TGA (raw or RLE, 24 or 32 bit) as RGBA, else null. */
export const decodeTga = (buf) => {
  if (buf.length < 18) return null;
  const idLength = buf[0];
  const type = buf[2];
  const width = buf.readUInt16LE(12);
  const height = buf.readUInt16LE(14);
  const bpp = buf[16];
  const topDown = (buf[17] & 0x20) !== 0;
  if ((type !== 2 && type !== 10) || (bpp !== 24 && bpp !== 32) || !width || !height) return null;
  const step = bpp / 8;
  const n = width * height;
  const pixels = new Uint8Array(n * 4);
  let at = 18 + idLength + (buf[1] ? buf.readUInt16LE(5) * Math.ceil(buf[7] / 8) : 0);
  const put = (i) => {
    pixels[i * 4] = buf[at + 2];
    pixels[i * 4 + 1] = buf[at + 1];
    pixels[i * 4 + 2] = buf[at];
    pixels[i * 4 + 3] = step === 4 ? buf[at + 3] : 255;
  };
  if (type === 2) {
    for (let i = 0; i < n && at + step <= buf.length; i += 1, at += step) put(i);
  } else {
    let i = 0;
    while (i < n && at < buf.length) {
      const head = buf[at];
      at += 1;
      const count = (head & 127) + 1;
      if (head & 128) {
        for (let k = 0; k < count && i < n; k += 1, i += 1) put(i);
        at += step;
      } else {
        for (let k = 0; k < count && i < n; k += 1, i += 1, at += step) put(i);
      }
    }
  }
  if (topDown) return { width, height, rgba: pixels };
  const rgba = new Uint8Array(n * 4);
  for (let y = 0; y < height; y += 1) {
    rgba.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
  }
  return { width, height, rgba };
};

/** A .blp or .tga icon file as PNG bytes, or null. */
export const toPng = (buf, ext) => {
  const image = ext === 'blp' ? decodeBlp(buf) : ext === 'tga' ? decodeTga(buf) : null;
  return image ? encodePng(image) : null;
};
