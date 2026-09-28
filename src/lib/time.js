/**
 * All stored timestamps are UTC ISO-8601 strings ending in `Z`, which sort
 * correctly as text in SQLite. A `Clock` is injectable so tests can move time.
 */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** @typedef {{ now: () => number }} Clock */

/** @type {Clock} */
export const systemClock = { now: () => Date.now() };

/** @param {number} ms epoch milliseconds */
export function toIso(ms) {
  return new Date(ms).toISOString();
}

/** @param {string} iso */
export function fromIso(iso) {
  return Date.parse(iso);
}

/** @param {Clock} clock */
export function nowIso(clock = systemClock) {
  return toIso(clock.now());
}
