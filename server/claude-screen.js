// @ts-check
// Claude Code's terminal as the page drives it: the screen as text, keys and typed text. What the screen shows is
// read here — the prompt box first of all.

/**
 * @typedef {{ read: () => Promise<string | undefined>, keys: (...keys: string[]) => Promise<boolean>, text: (text: string) => Promise<boolean> }} Terminal
 */

/** The rule lines above and below Claude Code's prompt box — the top one titled while its prompt history is browsed. */
const rule = /^\s*─{3,}(?: History \d+\/\d+ ─+)?\s*$/;

/**
 * The text in Claude Code's prompt box, its lines joined by spaces; undefined when the box is not on the screen (a menu
 * or a dialog is open).
 * @param {string} screen
 * @returns {string | undefined}
 */
export function inputBox(screen) {
  const lines = screen.split('\n');
  const rules = lines.flatMap((line, index) => (rule.test(line) ? [index] : []));
  const [top, bottom] = rules.slice(-2);
  if (top === undefined || bottom === undefined) return undefined;
  const [first, ...rest] = lines.slice(top + 1, bottom).map((line) => line.trim());
  if (first === undefined || !first.startsWith('❯')) return undefined;
  return [first.slice(1), ...rest].join(' ').trim();
}

/**
 * Text without whitespace, frame bars and ellipses: the terminal wraps and frames lines at its own width.
 * @param {string} text
 */
export function squash(text) {
  return text.replace(/[\s│…]/g, '');
}

/** A pause between looks at the screen. */
export const stepMs = 150;
const settleTries = 20;

/**
 * The screen once it is ready; undefined if it is not within a few seconds.
 * @param {Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 * @param {(screen: string) => boolean} ready
 * @returns {Promise<string | undefined>}
 */
export async function settleOn(terminal, wait, ready) {
  for (let attempt = 0; attempt < settleTries; attempt++) {
    const screen = await terminal.read();
    if (screen !== undefined && ready(screen)) return screen;
    await wait(stepMs);
  }
  return undefined;
}
