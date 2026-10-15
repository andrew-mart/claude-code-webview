// @ts-check
// Whether the browser is on the viewer's computer: there a file opened in the viewer's editor shows up before its user.
import { isRecord } from './narrow.js';

/** Addresses of this very computer: a page opened at one is on the viewer's computer. */
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * @typedef {{ instance: string, port: number, editor: boolean, vscode: boolean }} Machine — the viewer's /api/machine
 *   reply: the run of the viewer, its port, whether it has an editor, whether it runs VS Code in the browser
 * @typedef {'same' | 'elsewhere' | 'unknown' | 'none'} EditorReach
 */

/**
 * @param {unknown} json
 * @returns {Machine | undefined}
 */
export function parseMachine(json) {
  if (!isRecord(json) || typeof json.instance !== 'string' || typeof json.port !== 'number' || typeof json.editor !== 'boolean') return undefined;
  // a viewer from before VS Code in the browser says nothing of it: it runs none
  return { instance: json.instance, port: json.port, editor: json.editor, vscode: json.vscode === true };
}

/**
 * @param {Machine} own — what the viewer that served the page says
 * @param {{ hostname: string, local: Machine | undefined | 'unasked' }} browser — hostname: the page's address; local:
 *   what the viewer at the browser's 127.0.0.1 said, nothing if none answered
 * @returns {EditorReach}
 */
export function editorReach(own, browser) {
  if (!own.editor) return 'none';
  if (loopbackHosts.has(browser.hostname)) return 'same';
  if (browser.local === 'unasked') return 'unknown';
  return browser.local?.instance === own.instance ? 'same' : 'elsewhere';
}
