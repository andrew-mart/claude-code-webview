// @ts-check
// The account's usage of Claude — the 5-hour window and the week, how much of each is used and when it resets — from
// the freshest of two readings: Claude Code's own, kept in ~/.claude.json (cachedUsageUtilization) and made only now
// and then, and the one a statusline is given with every reply (rate_limits), if the statusline drops it into a file.
import { readFile, stat } from 'node:fs/promises';
import { isRecord } from '../public/model/narrow.js';

/** @typedef {import('../public/model/usage.js').Usage} Usage */
/** @typedef {import('../public/model/usage.js').UsageWindow} UsageWindow */

/**
 * @param {{ claudeState: string, rateLimits: string }} files — ~/.claude.json; the file a statusline drops rate_limits into
 * @returns {Promise<Usage | undefined>} — none until either has a reading
 */
export async function readUsage(files) {
  const [claudeState, rateLimits] = await Promise.all([readJson(files.claudeState), readJson(files.rateLimits)]);
  const readings = [
    claudeState === undefined ? undefined : usageOf(claudeState.json),
    rateLimits === undefined ? undefined : usageOfRateLimits(rateLimits.json, rateLimits.writtenAt),
  ].filter((reading) => reading !== undefined);
  const [freshest] = readings.toSorted((one, other) => other.readAt - one.readAt);
  return freshest;
}

/**
 * @param {unknown} claudeState — ~/.claude.json
 * @returns {Usage | undefined} — none until Claude Code has read the usage
 */
export function usageOf(claudeState) {
  const cached = isRecord(claudeState) && isRecord(claudeState.cachedUsageUtilization) ? claudeState.cachedUsageUtilization : undefined;
  const windows = cached !== undefined && isRecord(cached.utilization) ? cached.utilization : undefined;
  if (cached === undefined || windows === undefined || typeof cached.fetchedAtMs !== 'number') return undefined;
  return { fiveHour: cachedWindow(windows.five_hour), sevenDay: cachedWindow(windows.seven_day), readAt: cached.fetchedAtMs };
}

/**
 * @param {unknown} json — { utilization: percent, resets_at: ISO time }
 * @returns {UsageWindow | undefined}
 */
function cachedWindow(json) {
  if (!isRecord(json) || typeof json.utilization !== 'number') return undefined;
  const resetsAt = typeof json.resets_at === 'string' ? Date.parse(json.resets_at) : Number.NaN;
  return { percent: json.utilization, resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined };
}

/**
 * @param {unknown} rateLimits — the statusline's rate_limits: { five_hour, seven_day }, absent before the first reply
 * @param {number} givenAt — when the statusline was given it, ms
 * @returns {Usage | undefined}
 */
function usageOfRateLimits(rateLimits, givenAt) {
  if (!isRecord(rateLimits)) return undefined;
  const fiveHour = givenWindow(rateLimits.five_hour);
  const sevenDay = givenWindow(rateLimits.seven_day);
  return fiveHour === undefined && sevenDay === undefined ? undefined : { fiveHour, sevenDay, readAt: givenAt };
}

/**
 * @param {unknown} json — { used_percentage: percent, resets_at: s }
 * @returns {UsageWindow | undefined}
 */
function givenWindow(json) {
  if (!isRecord(json) || typeof json.used_percentage !== 'number') return undefined;
  return { percent: json.used_percentage, resetsAt: typeof json.resets_at === 'number' ? json.resets_at * 1000 : undefined };
}

/**
 * A JSON file and when it was written; none if it is missing or caught half-written.
 * @param {string} path
 * @returns {Promise<{ json: unknown, writtenAt: number } | undefined>}
 */
async function readJson(path) {
  const [text, written] = await Promise.all([readFile(path, 'utf8').catch(() => undefined), stat(path).catch(() => undefined)]);
  if (text === undefined || written === undefined) return undefined;
  try {
    return { json: JSON.parse(text), writtenAt: Math.round(written.mtimeMs) };
  } catch {
    return undefined;
  }
}
