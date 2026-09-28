import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadEnv, EnvError } from '../src/lib/env.js';
import { parseApiKeys, findApiKey } from '../src/lib/api-keys.js';
import { sha256 } from '../src/lib/crypto.js';
import { envVars, API_KEYS, KEYS } from './helpers.js';

test('loads a complete environment', () => {
  const env = loadEnv(envVars({ SITE_URL: 'https://example.test/' }));
  assert.equal(env.port, 3000);
  assert.equal(env.siteUrl, 'https://example.test');
  assert.equal(env.apiKeys.length, 4);
  const relative = loadEnv(envVars({ DATA_DIR: './data' }));
  assert.ok(path.isAbsolute(relative.dataDir), 'DATA_DIR is resolved to an absolute path');
  assert.equal(env.production, false);
});

test('fails closed, naming every missing variable', () => {
  const vars = envVars({ N8N_SIGNING_SECRET: '', API_KEYS: undefined });
  assert.throws(
    () => loadEnv(vars),
    (err) =>
      err instanceof EnvError &&
      err.message.includes('N8N_SIGNING_SECRET') &&
      err.message.includes('API_KEYS'),
  );
});

test('production also requires LITESTREAM_*', () => {
  assert.throws(
    () => loadEnv(envVars({ NODE_ENV: 'production' })),
    (err) => err instanceof EnvError && err.message.includes('LITESTREAM_BUCKET'),
  );
});

test('rejects a bad PORT and a non-URL SITE_URL', () => {
  assert.throws(() => loadEnv(envVars({ PORT: 'abc' })), /PORT/);
  assert.throws(() => loadEnv(envVars({ SITE_URL: 'example.test' })), /SITE_URL/);
});

test('API_KEYS parsing validates shape, scopes and hashes', () => {
  assert.equal(parseApiKeys(API_KEYS)[1].scopes.join(), 'leads:read,content:read');
  assert.throws(() => parseApiKeys('nope'), /name:scopes:sha256hex/);
  assert.throws(() => parseApiKeys(`a:root:${sha256('x')}`), /unknown scope/);
  assert.throws(() => parseApiKeys('a:admin:nothex'), /name:scopes:sha256hex/);
  assert.throws(() => parseApiKeys(`a:admin:${sha256('x')};a:admin:${sha256('y')}`), /duplicate/);
});

test('findApiKey matches by hash only', () => {
  const keys = parseApiKeys(API_KEYS);
  assert.equal(findApiKey(keys, KEYS.reader)?.name, 'reader');
  assert.equal(findApiKey(keys, KEYS.reader + 'x'), undefined);
  assert.equal(findApiKey(keys, ''), undefined);
});
