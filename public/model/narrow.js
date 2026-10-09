// @ts-check
// Narrowing of values of unknown shape from transcript JSON.

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function text(value) {
  return typeof value === 'string' ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
export function count(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
