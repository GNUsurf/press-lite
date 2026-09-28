import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** @param {string | Buffer} input @returns {string} lowercase hex */
export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

/** @param {string} secret @param {string} message @returns {string} lowercase hex */
export function hmacSha256(secret, message) {
  return createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Constant-time comparison of two hex digests. Lengths are compared first
 * because `timingSafeEqual` throws on mismatched lengths.
 * @param {string} a @param {string} b
 */
export function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** 32 random bytes, base64url: an API key or similar secret. */
export function randomSecret() {
  return randomBytes(32).toString('base64url');
}

export function uuid() {
  return randomUUID();
}
