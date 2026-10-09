// @ts-check
// Arguments of the claude-code-webview command.
import { parseArgs } from 'node:util';

/**
 * @typedef {'serve' | 'background' | 'stop' | 'restart' | 'install-shortcut' | 'help' | 'version'} Action
 * @typedef {{ action: Action, port: number, open: boolean, startMenu: boolean }} Command
 */

export const defaultPort = 7788;

/** Flags that each select the action of the same name; with none of them — serve. */
const actionFlags = /** @type {const} */ (['background', 'stop', 'restart', 'install-shortcut', 'help', 'version']);

/**
 * @param {readonly string[]} argv — arguments after the command name
 * @returns {{ ok: true, command: Command } | { ok: false, error: string }}
 */
export function parseCommand(argv) {
  /** @type {ReturnType<typeof parseOptions>} */
  let values;
  try {
    values = parseOptions(argv);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const chosen = actionFlags.filter((flag) => values[flag]);
  if (chosen.length > 1) return { ok: false, error: `Choose one action: ${chosen.map((flag) => `--${flag}`).join(' and ')} cannot be used together.` };
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: `Invalid --port value "${values.port}": expected a number from 1 to 65535.` };
  return { ok: true, command: { action: chosen[0] ?? 'serve', port, open: !values['no-open'], startMenu: values['start-menu'] } };
}

/** @param {readonly string[]} argv */
function parseOptions(argv) {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      port: { type: 'string', short: 'p', default: String(defaultPort) },
      'no-open': { type: 'boolean', default: false },
      background: { type: 'boolean', short: 'b', default: false },
      stop: { type: 'boolean', default: false },
      restart: { type: 'boolean', default: false },
      'install-shortcut': { type: 'boolean', default: false },
      'start-menu': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  return values;
}
