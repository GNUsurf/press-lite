/**
 * Add query parameters to a same-site path, keeping any `#fragment` last.
 * `withQuery('/#subscribe', { sent: '1' })` → `/?sent=1#subscribe`.
 * @param {string} target
 * @param {Record<string, string>} params
 */
export function withQuery(target, params) {
  const [pathAndQuery, fragment] = target.split('#', 2);
  const [path, query = ''] = pathAndQuery.split('?', 2);
  const search = new URLSearchParams(query);
  for (const [k, v] of Object.entries(params)) search.set(k, v);
  const qs = search.toString();
  return `${path}${qs ? `?${qs}` : ''}${fragment ? `#${fragment}` : ''}`;
}

/**
 * Join an origin and a path into an absolute URL with exactly one slash.
 * @param {string} origin
 * @param {string} path
 */
export function absoluteUrl(origin, path) {
  return `${origin.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
