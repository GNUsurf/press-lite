/**
 * Strip metadata from images before they are stored: EXIF (GPS, device),
 * XMP, IPTC, comments and text chunks. A photo straight off a phone must not
 * publish its coordinates. Pixel data and the chunks needed to display the
 * image correctly (colour profile, gamma, transparency) are kept.
 *
 * No image library: each format is a sequence of tagged chunks, and this
 * copies the ones we keep.
 */

/**
 * @param {Buffer} buf
 * @param {'png' | 'jpeg' | 'webp'} type   as detected by image-size.js
 * @returns {Buffer} a new buffer, or the input when nothing was removed
 */
export function stripMetadata(buf, type) {
  switch (type) {
    case 'jpeg':
      return stripJpeg(buf);
    case 'png':
      return stripPng(buf);
    case 'webp':
      return stripWebp(buf);
    default:
      return buf;
  }
}

/** JPEG: drop every APPn segment except APP0 (JFIF) and APP2 (ICC), and COM. @param {Buffer} buf */
function stripJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  let offset = 2;
  let removed = false;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    if (marker === 0xda) {
      // Start of scan: everything from here to the end is entropy-coded data.
      out.push(buf.subarray(offset));
      break;
    }
    const length = buf.readUInt16BE(offset + 2);
    const segment = buf.subarray(offset, offset + 2 + length);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep = !(isApp && marker !== 0xe0 && marker !== 0xe2) && marker !== 0xfe;
    if (keep) out.push(segment);
    else removed = true;
    offset += 2 + length;
  }
  return removed ? Buffer.concat(out) : buf;
}

/** PNG chunks that carry text or EXIF; everything else is kept. */
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/** @param {Buffer} buf */
function stripPng(buf) {
  const out = [buf.subarray(0, 8)];
  let offset = 8;
  let removed = false;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const name = buf.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (PNG_DROP.has(name)) removed = true;
    else out.push(buf.subarray(offset, end));
    offset = end;
    if (name === 'IEND') break;
  }
  return removed ? Buffer.concat(out) : buf;
}

/** WebP (RIFF): drop EXIF and XMP chunks and clear their flags in VP8X. @param {Buffer} buf */
function stripWebp(buf) {
  const chunks = [];
  let offset = 12;
  let removed = false;
  while (offset + 8 <= buf.length) {
    const name = buf.toString('ascii', offset, offset + 4);
    const length = buf.readUInt32LE(offset + 4);
    const padded = length + (length % 2);
    const chunk = Buffer.from(buf.subarray(offset, offset + 8 + padded));
    if (name === 'EXIF' || name === 'XMP ') removed = true;
    else chunks.push(chunk);
    offset += 8 + padded;
  }
  if (!removed) return buf;
  const vp8x = chunks.find((c) => c.toString('ascii', 0, 4) === 'VP8X');
  if (vp8x) vp8x[8] &= ~0x0c; // bit 3 = EXIF, bit 2 = XMP
  const body = Buffer.concat(chunks);
  const header = Buffer.from(buf.subarray(0, 12));
  header.writeUInt32LE(4 + body.length, 4);
  return Buffer.concat([header, body]);
}
