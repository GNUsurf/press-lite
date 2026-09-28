#!/usr/bin/env node
/**
 * Generate an API key for n8n and the line to add to API_KEYS.
 *
 *   node scripts/key.js <name> <scope[,scope]>
 *   node scripts/key.js n8n leads:read,leads:write
 *
 * The raw key is printed once and never stored anywhere on the server.
 */
import { randomSecret, sha256 } from '../src/lib/crypto.js';
import { SCOPES } from '../src/lib/api-keys.js';

const [name, scopeArg] = process.argv.slice(2);
const scopes = scopeArg?.split(',').map((s) => s.trim()) ?? [];

if (!name || !/^[a-z0-9-]{1,32}$/.test(name) || !scopes.length) {
  console.error('usage: node scripts/key.js <name: [a-z0-9-]> <scope[,scope]>');
  console.error(`scopes: ${SCOPES.join(', ')}`);
  process.exit(2);
}
const unknown = scopes.filter((s) => !SCOPES.includes(/** @type {any} */ (s)));
if (unknown.length) {
  console.error(`unknown scope(s): ${unknown.join(', ')}`);
  process.exit(2);
}

const key = randomSecret();
console.log(`API key for "${name}" (give this to n8n; it is not stored here):\n`);
console.log(`  ${key}\n`);
console.log('Append to API_KEYS (separate entries with ";"):\n');
console.log(`  ${name}:${scopes.join(',')}:${sha256(key)}`);
