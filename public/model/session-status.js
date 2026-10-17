// @ts-check

/**
 * A statusline's reading of the selected model and its live context, independent of transcript messages.
 * @typedef {Readonly<{ at: number, model: string, contextTokens?: number, contextWindow?: number, effort?: string }>} SessionStatus
 */
import { isRecord } from './narrow.js';

/** @param {unknown} raw @returns {SessionStatus | undefined} */
export function parseSessionStatus(raw) {
  if (!isRecord(raw) || typeof raw.at !== 'number' || !Number.isFinite(raw.at) || raw.at < 0 || typeof raw.model !== 'string' || raw.model.trim() === '' || raw.model.length > 200 || /[\u0000-\u001f]/.test(raw.model)) return undefined;
  const tokens = tokenCount(raw.contextTokens);
  const window = tokenCount(raw.contextWindow);
  const effort = typeof raw.effort === 'string' && ['low', 'medium', 'high', 'xhigh', 'max'].includes(raw.effort) ? raw.effort : undefined;
  return {
    at: raw.at, model: raw.model.trim(),
    ...(tokens === undefined ? {} : { contextTokens: tokens }),
    ...(window === undefined || window === 0 ? {} : { contextWindow: window }),
    ...(effort === undefined ? {} : { effort }),
  };
}

/** @param {unknown} value @returns {number | undefined} */
function tokenCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
