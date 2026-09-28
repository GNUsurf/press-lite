/**
 * Environment loading. Fails closed: a missing required variable throws an
 * `EnvError` naming it, and `main()` turns that into a non-zero exit.
 * There are no defaults for secrets.
 */
import { parseApiKeys } from './api-keys.js';

const REQUIRED = [
  'PORT',
  'DATA_DIR',
  'SITE_URL',
  'N8N_WEBHOOK_URL',
  'N8N_WEBHOOK_TOKEN',
  'N8N_SIGNING_SECRET',
  'API_KEYS',
];

const REQUIRED_IN_PRODUCTION = [
  'LITESTREAM_BUCKET',
  'LITESTREAM_ENDPOINT',
  'LITESTREAM_ACCESS_KEY_ID',
  'LITESTREAM_SECRET_ACCESS_KEY',
];

export class EnvError extends Error {}

/**
 * @typedef {object} Env
 * @property {number} port
 * @property {string} dataDir
 * @property {string} siteUrl                 origin without trailing slash
 * @property {string} n8nWebhookUrl
 * @property {string} n8nWebhookToken
 * @property {string} n8nSigningSecret
 * @property {import('./api-keys.js').ApiKey[]} apiKeys
 * @property {boolean} production
 */

/**
 * @param {NodeJS.ProcessEnv} source
 * @returns {Env}
 */
export function loadEnv(source = process.env) {
  const production = source.NODE_ENV === 'production';
  const required = production ? [...REQUIRED, ...REQUIRED_IN_PRODUCTION] : REQUIRED;
  const missing = required.filter((name) => !source[name]?.trim());
  if (missing.length) {
    throw new EnvError(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const port = Number(source.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EnvError(`PORT must be an integer between 1 and 65535, got "${source.PORT}"`);
  }

  const siteUrl = parseOrigin('SITE_URL', /** @type {string} */ (source.SITE_URL));
  parseOrigin('N8N_WEBHOOK_URL', /** @type {string} */ (source.N8N_WEBHOOK_URL));

  return Object.freeze({
    port,
    dataDir: /** @type {string} */ (source.DATA_DIR),
    siteUrl,
    n8nWebhookUrl: /** @type {string} */ (source.N8N_WEBHOOK_URL),
    n8nWebhookToken: /** @type {string} */ (source.N8N_WEBHOOK_TOKEN),
    n8nSigningSecret: /** @type {string} */ (source.N8N_SIGNING_SECRET),
    apiKeys: parseApiKeys(/** @type {string} */ (source.API_KEYS)),
    production,
  });
}

/** @param {string} name @param {string} value */
function parseOrigin(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new EnvError(`${name} must be an absolute URL, got "${value}"`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new EnvError(`${name} must be http(s)`);
  return url.origin;
}
