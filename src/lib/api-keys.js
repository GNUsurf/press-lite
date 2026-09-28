/**
 * API keys for the v1 API. Raw keys are never stored: `API_KEYS` holds
 * `name:scope,scope:sha256hex;name2:scope:sha256hex` as produced by
 * `scripts/key.js`, and a presented key is hashed and compared in constant time.
 */
import { sha256, timingSafeEqualHex } from './crypto.js';

export const SCOPES = /** @type {const} */ (['leads:read', 'leads:write', 'admin']);
/** @typedef {typeof SCOPES[number]} Scope */

/**
 * @typedef {object} ApiKey
 * @property {string} name
 * @property {Scope[]} scopes
 * @property {string} hash  lowercase sha256 hex
 */

/**
 * @param {string} spec
 * @returns {ApiKey[]}
 */
export function parseApiKeys(spec) {
  const entries = spec
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!entries.length) throw new Error('API_KEYS is empty');

  const keys = entries.map((entry) => {
    // Scopes contain ':' themselves, so anchor on the name (first field) and
    // the hash (last field) rather than splitting on every colon.
    const match = /^([a-z0-9-]{1,32}):(.+):([0-9a-f]{64})$/i.exec(entry);
    if (!match) throw new Error(`API_KEYS entry "${label(entry)}" is not name:scopes:sha256hex`);
    const [, name, scopeList, hash] = match;
    const scopes = scopeList.split(',').map((s) => s.trim());
    for (const scope of scopes) {
      if (!SCOPES.includes(/** @type {Scope} */ (scope))) {
        throw new Error(`API_KEYS entry "${name}" has unknown scope "${scope}"`);
      }
    }
    return { name, scopes: /** @type {Scope[]} */ (scopes), hash: hash.toLowerCase() };
  });

  const names = new Set(keys.map((k) => k.name));
  if (names.size !== keys.length) throw new Error('API_KEYS has duplicate names');
  return keys;
}

/** The entry's name for error messages, never its hash. @param {string} entry */
function label(entry) {
  return entry.split(':')[0];
}

/**
 * Find the key matching a presented secret. Compares against every key so
 * timing doesn't reveal which (if any) matched.
 * @param {ApiKey[]} keys
 * @param {string} presented
 * @returns {ApiKey | undefined}
 */
export function findApiKey(keys, presented) {
  const hash = sha256(presented);
  let found;
  for (const key of keys) {
    if (timingSafeEqualHex(key.hash, hash)) found = key;
  }
  return found;
}
