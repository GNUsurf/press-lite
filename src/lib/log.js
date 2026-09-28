/**
 * Pino options for Fastify's built-in logger. Leads contain PII, so the
 * fields that could carry it are redacted wherever they appear, and request
 * bodies are never logged (Fastify doesn't by default; keep it that way).
 */

const PII_FIELDS = ['email', 'name', 'message', 'notes', 'company'];

/** @param {string} [level] */
export function loggerOptions(level = process.env.LOG_LEVEL || 'info') {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-webhook-token"]',
        ...PII_FIELDS,
        ...PII_FIELDS.map((f) => `*.${f}`),
        ...PII_FIELDS.map((f) => `*.*.${f}`),
      ],
      censor: '[redacted]',
    },
  };
}
