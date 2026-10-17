// @ts-check
// What the session header tells about a session: the model by its name, how full its context window is.

/**
 * claude-<family>-<major>[-<minor>][-<date>][[1m]]: "claude-opus-5-5", "claude-haiku-4-5-20251001", "claude-opus-4-6[1m]".
 * The minor version is one or two digits; a date has eight.
 */
const claudeModel = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/;

/**
 * The first version of each family that Claude Code runs with a 1M window by default (major × 100 + minor); the
 * earlier ones have 200K, or 1M through their [1m] variant. From the Claude Code model configuration docs.
 * @type {Readonly<Record<string, number>>}
 */
const nativeMillionFrom = { fable: 0, sonnet: 500, haiku: 505, opus: 407 };
const million = 1_000_000;
const standardWindow = 200_000;
/** From here the window is worth watching; from hot on, compaction is near (1M windows compact at about 96.7%). */
const warmShare = 0.7;
const hotShare = 0.9;

/**
 * @param {string} id
 * @returns {{ family: string, name: string, version: number } | undefined}
 */
function parseClaudeModel(id) {
  const [, family, major, minor] = claudeModel.exec(id) ?? [];
  if (family === undefined || major === undefined) return undefined;
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}`;
  return { family, name, version: Number(major) * 100 + Number(minor ?? 0) };
}

/**
 * @param {string} id — the model id from the transcript
 * @returns {string}
 */
export function modelName(id) {
  return parseClaudeModel(id)?.name ?? id;
}

/**
 * @typedef {{ tokens: number, window: undefined } | { tokens: number, window: number, left: number, share: number, level: 'calm' | 'warm' | 'hot' }} ContextGauge
 */

/**
 * @param {{ model: string, tokens: number, extended: boolean, window?: number | undefined }} context
 *   tokens — what the latest answer received as input; extended — the session's costs name a [1m] model
 * @returns {ContextGauge}
 */
export function contextGauge({ model, tokens, extended, window: reportedWindow }) {
  const window = reportedWindow ?? contextWindow(model, extended || tokens > standardWindow);
  if (window === undefined) return { tokens, window };
  const share = Math.min(tokens / window, 1);
  return { tokens, window, left: Math.max(window - tokens, 0), share, level: share >= hotShare ? 'hot' : share >= warmShare ? 'warm' : 'calm' };
}

/**
 * @param {string} model
 * @param {boolean} extended — the session is known to run the [1m] variant
 * @returns {number | undefined}
 */
function contextWindow(model, extended) {
  const parsed = parseClaudeModel(model);
  if (parsed === undefined) return undefined;
  const nativeFrom = nativeMillionFrom[parsed.family];
  return extended || (nativeFrom !== undefined && parsed.version >= nativeFrom) ? million : standardWindow;
}
