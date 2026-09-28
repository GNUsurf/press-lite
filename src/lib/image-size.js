/**
 * Read width/height from PNG, JPEG and WebP headers, so every <img> can carry
 * dimensions without an image library. Returns null for anything else.
 */
import fs from 'node:fs';

/**
 * @param {string} file
 * @returns {{ width: number, height: number, type: 'png' | 'jpeg' | 'webp' } | null}
 */
export function imageSize(file) {
  return imageSizeOf(fs.readFileSync(file));
}

/**
 * @param {Buffer} buf
 * @returns {{ width: number, height: number, type: 'png' | 'jpeg' | 'webp' } | null}
 */
export function imageSizeOf(buf) {
  return png(buf) ?? jpeg(buf) ?? webp(buf);
}

/** @param {Buffer} buf */
function png(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    type: /** @type {const} */ ('png'),
  };
}

/** @param {Buffer} buf */
function jpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
        type: /** @type {const} */ ('jpeg'),
      };
    }
    offset += 2 + buf.readUInt16BE(offset + 2);
  }
  return null;
}

/** @param {Buffer} buf */
function webp(buf) {
  if (
    buf.length < 30 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const chunk = buf.toString('ascii', 12, 16);
  const type = /** @type {const} */ ('webp');
  if (chunk === 'VP8X') {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), type };
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff), type };
  }
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, type };
  }
  return null;
}
