// @ts-check
// A process ended as its user would end it: asked to stop — SIGTERM, on which Claude Code ends itself; Windows ends it
// outright — then waited for until it is gone.
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord } from '../public/model/narrow.js';

/**
 * @param {number} pid
 * @param {{ waitMs: number, stepMs: number }} pace — how long it is waited for at most, and how often it is looked at
 * @returns {Promise<boolean>} — true once it is gone, one gone already too; false for one still there, or not ours
 */
export async function endProcess(pid, { waitMs, stepMs }) {
  try {
    process.kill(pid);
  } catch (error) {
    return isGone(error);
  }
  for (let waited = 0; waited < waitMs; waited += stepMs) {
    if (!isRunning(pid)) return true;
    await delay(stepMs);
  }
  return !isRunning(pid);
}

/** @param {number} pid */
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isGone(error);
  }
}

/**
 * Whether a signal failed for the process being gone — rather than for its being another user's.
 * @param {unknown} error
 */
function isGone(error) {
  return isRecord(error) && error.code === 'ESRCH';
}
