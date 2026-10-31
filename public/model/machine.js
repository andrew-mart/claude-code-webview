// @ts-check
// Whether the browser is on the viewer's computer: there a file opened in the viewer's editor — or in the computer's own
// VS Code — shows up before its user.
import { isRecord } from './narrow.js';

/** Addresses of this very computer: a page opened at one is on the viewer's computer. */
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * @typedef {{ instance: string, port: number, editor: boolean, vscode: boolean, separator: import('./folders.js').PathSeparator }} Machine
 *   — the viewer's /api/machine reply: the run of the viewer, its port, whether it has an editor, whether it runs VS Code
 *   in the browser, how its computer parts a path
 * @typedef {'same' | 'elsewhere' | 'blocked' | 'unknown'} BrowserPlace — blocked: the browser did not let the page reach
 *   this computer's apps, so where it is is not known until it does
 * @typedef {BrowserPlace | 'none'} EditorReach — none: nothing to open there, or a phone's browser
 * @typedef {Machine | 'no-answer' | 'refused'} LocalAnswer — what the viewer at the browser's 127.0.0.1 said; nothing
 *   answering there, or the browser refusing the page this computer's apps
 */

/**
 * @param {unknown} json
 * @returns {Machine | undefined}
 */
export function parseMachine(json) {
  if (!isRecord(json) || typeof json.instance !== 'string' || typeof json.port !== 'number' || typeof json.editor !== 'boolean') return undefined;
  // a viewer from before VS Code in the browser says nothing of it: it runs none; one from before it told how its
  // computer parts a path is taken for one with forward slashes
  return { instance: json.instance, port: json.port, editor: json.editor, vscode: json.vscode === true, separator: json.separator === '\\' ? '\\' : '/' };
}

/**
 * @param {Machine} own — what the viewer that served the page says
 * @param {{ hostname: string, local: LocalAnswer | 'unasked' }} browser — hostname: the page's address; local: what the
 *   viewer at the browser's 127.0.0.1 said
 * @returns {BrowserPlace}
 */
export function browserPlace(own, browser) {
  if (loopbackHosts.has(browser.hostname)) return 'same';
  switch (browser.local) {
    case 'unasked':
      return 'unknown';
    case 'refused':
      return 'blocked';
    case 'no-answer':
      return 'elsewhere';
    default:
      return browser.local.instance === own.instance ? 'same' : 'elsewhere';
  }
}
