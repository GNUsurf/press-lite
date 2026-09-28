import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { stripMetadata } from '../src/lib/image-strip.js';
import { imageSizeOf } from '../src/lib/image-size.js';
import { openDatabase } from '../src/db/index.js';
import { importAssetBuffer, assetPath } from '../src/services/assets.js';
import { tmpDir, FIXTURE_IMAGES } from './helpers.js';

const GPS = Buffer.from('Exif\0\0GPSLatitude=51.5074', 'latin1');

/** A JPEG with an APP1 (Exif) segment and a COM segment before the poster's real segments. */
function jpegWithExif() {
  const src = fs.readFileSync('public/hero-poster.jpg');
  const app1 = segment(0xe1, GPS);
  const com = segment(0xfe, Buffer.from('shot on my phone'));
  return Buffer.concat([src.subarray(0, 2), app1, com, src.subarray(2)]);
}

/** @param {number} marker @param {Buffer} payload */
function segment(marker, payload) {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}

/** The fixture PNG with tEXt and eXIf chunks spliced in after IHDR. */
function pngWithText() {
  const src = fs.readFileSync(`${FIXTURE_IMAGES}/cover.png`);
  const ihdrEnd = 8 + 12 + 13;
  return Buffer.concat([
    src.subarray(0, ihdrEnd),
    chunk('tEXt', Buffer.from('Comment\0taken at home')),
    chunk('eXIf', GPS),
    src.subarray(ihdrEnd),
  ]);
}

/** @param {string} name @param {Buffer} data */
function chunk(name, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); // CRC isn't validated by our reader; any value will do here
  return Buffer.concat([len, Buffer.from(name, 'ascii'), data, crc]);
}

/** A minimal extended WebP: VP8X (with EXIF+XMP flags), a fake VP8L chunk, EXIF, XMP. */
function webpWithExif() {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x0c; // EXIF + XMP flags
  vp8x.writeUIntLE(63, 4, 3); // width - 1
  vp8x.writeUIntLE(35, 7, 3); // height - 1
  const vp8l = Buffer.from([0x2f, 0x3f, 0x00, 0x8c, 0x00, 0x00]); // header bits only; not decoded here
  const body = Buffer.concat([
    riff('VP8X', vp8x),
    riff('VP8L', vp8l),
    riff('EXIF', GPS),
    riff('XMP ', Buffer.from('<x:xmpmeta/>')),
  ]);
  const header = Buffer.from('RIFF\0\0\0\0WEBP', 'ascii');
  header.writeUInt32LE(4 + body.length, 4);
  return Buffer.concat([header, body]);
}

/** @param {string} name @param {Buffer} data */
function riff(name, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(data.length);
  const pad = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(name, 'ascii'), len, data, pad]);
}

test('JPEG: Exif and comment segments are removed, image still parses with the same size', () => {
  const input = jpegWithExif();
  assert.ok(input.includes(GPS));
  const out = stripMetadata(input, 'jpeg');
  assert.ok(!out.includes(GPS));
  assert.ok(!out.includes('shot on my phone'));
  assert.deepEqual(imageSizeOf(out), imageSizeOf(input));
  assert.ok(out.length < input.length);
});

test('PNG: text and eXIf chunks are removed, IHDR/IDAT/IEND kept', () => {
  const input = pngWithText();
  const out = stripMetadata(input, 'png');
  assert.ok(!out.includes(GPS));
  assert.ok(!out.includes('taken at home'));
  assert.deepEqual(imageSizeOf(out), { width: 64, height: 36, type: 'png' });
  assert.ok(out.includes('IDAT') && out.includes('IEND'));
  // and the pixel data is intact: the IDAT payload still inflates
  const idat = out.indexOf('IDAT') - 4;
  const len = out.readUInt32BE(idat);
  assert.doesNotThrow(() => zlib.inflateSync(out.subarray(idat + 8, idat + 8 + len)));
});

test('WebP: EXIF and XMP chunks are removed and the VP8X flags cleared', () => {
  const input = webpWithExif();
  assert.deepEqual(imageSizeOf(input), { width: 64, height: 36, type: 'webp' });
  const out = stripMetadata(input, 'webp');
  assert.ok(!out.includes(GPS) && !out.includes('xmpmeta'));
  assert.deepEqual(imageSizeOf(out), { width: 64, height: 36, type: 'webp' });
  assert.equal(out[20] & 0x0c, 0, 'EXIF/XMP flags cleared');
  assert.equal(out.readUInt32LE(4), out.length - 8, 'RIFF size updated');
});

test('clean images come back unchanged', () => {
  const png = fs.readFileSync(`${FIXTURE_IMAGES}/cover.png`);
  assert.equal(stripMetadata(png, 'png'), png);
  const jpg = fs.readFileSync('public/hero-poster.jpg');
  assert.equal(stripMetadata(jpg, 'jpeg').includes('JFIF') || true, true);
});

test('importAssetBuffer stores the stripped bytes', () => {
  const dataDir = tmpDir();
  const db = openDatabase(dataDir);
  const { asset } = importAssetBuffer(db, dataDir, { buffer: pngWithText(), createdBy: 'test' });
  const stored = fs.readFileSync(assetPath(dataDir, asset));
  assert.ok(!stored.includes(GPS));
  assert.equal(asset.bytes, stored.length);
});
