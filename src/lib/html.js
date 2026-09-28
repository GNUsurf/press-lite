/**
 * Auto-escaping HTML tagged template.
 *
 * Every interpolated value is escaped unless it is a `Raw` produced by `html`
 * itself or by `raw()`. Arrays are joined; `null`, `undefined` and `false`
 * render as nothing, so `${cond && html`...`}` works.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[/** @type {keyof ESCAPES} */ (c)]);
}

export class Raw {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/**
 * Mark a string as already-safe HTML. Only use on output that was sanitized
 * elsewhere (markdown-it with `html: false`), never on user or config input.
 * @param {string} value
 */
export function raw(value) {
  return new Raw(String(value));
}

/** @param {unknown} value @returns {string} */
function render(value) {
  if (value == null || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

/** @param {TemplateStringsArray} strings @param {unknown[]} values */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

/**
 * Escaping alone can't stop `href="javascript:..."`, so URLs that end up in
 * `href`/`src` go through this. Anything but http(s), mailto, tel or a
 * same-site path becomes `#`.
 * @param {unknown} value
 */
export function safeUrl(value) {
  const url = String(value ?? '').trim();
  if (/^(\/(?!\/)|#|\?)/.test(url)) return url;
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  return '#';
}
