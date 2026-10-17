// @ts-check
// Arguments of the claude-code-webview command.
import { parseArgs } from 'node:util';
import { paletteNamed, palettes } from '../public/model/palettes.js';
import { parseEditorCommand } from '../server/editor.js';

/**
 * @typedef {'serve' | 'background' | 'stop' | 'restart' | 'install-shortcut' | 'help' | 'version'} Action
 * @typedef {{ action: Action, port: number, open: boolean, startMenu: boolean, palette: import('../public/model/palettes.js').Palette, publicAddresses: readonly import('../server/app.js').PublicAddress[], herdr: 'on' | 'off', claudeCommand: string, claudeGptCommand?: string | undefined, chatgptUsageFile?: string | undefined, codexCommand: string, editor: Editor | undefined, vscode: string | undefined }} Command — herdr: off —
 *   not used even when found, the page only reads sessions; claudeCommand: what starts Claude Code in a tab opened from
 *   the page; editor: what opens a file of the file panel in an editor, none if not given; vscode: the VS Code CLI
 *   that runs VS Code in the browser at /vscode/, none if not given
 * @typedef {{ text: string, command: import('../server/editor.js').EditorCommand }} Editor — text: as it was given
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
  const palette = paletteNamed(values.palette);
  if (palette === undefined) return { ok: false, error: `Invalid --palette value "${values.palette}": expected one of ${palettes.join(', ')}.` };
  /** @type {import('../server/app.js').PublicAddress[]} */
  const publicAddresses = [];
  for (const value of values['public-url']) {
    const address = publicAddressOf(value);
    if (address === undefined) return { ok: false, error: `Invalid --public-url value "${value}": expected the address the page is opened at from outside, such as https://viewer.example.com.` };
    publicAddresses.push(address);
  }
  const claudeCommand = values['claude-command'].trim();
  // typed into a terminal and run with Enter: one line
  if (claudeCommand === '' || /[\r\n]/.test(claudeCommand)) return { ok: false, error: `Invalid --claude-command value "${values['claude-command']}": expected the command that starts Claude Code in a terminal, such as claude.` };
  const codexCommand = values['codex-command'].trim();
  const claudeGptCommand = values['claude-gpt-command']?.trim();
  const chatgptUsageFile = values['chatgpt-usage-file']?.trim();
  if (chatgptUsageFile === '') return { ok: false, error: 'Invalid --chatgpt-usage-file: expected a file path.' };
  if (claudeGptCommand !== undefined && (claudeGptCommand === '' || /[\r\n]/.test(claudeGptCommand))) return { ok: false, error: 'Invalid --claude-gpt-command: expected a command on one line.' };
  if (codexCommand === '' || /[\r\n]/.test(codexCommand)) return { ok: false, error: `Invalid --codex-command value "${values['codex-command']}": expected the command that starts Codex in a terminal, such as codex.` };
  const editorText = values['editor-command']?.trim();
  const editorCommand = editorText === undefined ? undefined : parseEditorCommand(editorText);
  if (editorText !== undefined && editorCommand === undefined) return { ok: false, error: `Invalid --editor-command value "${values['editor-command']}": expected the command of an editor with {path} for the file — and {line}, {project} if it takes them — such as "code --goto {path}:{line}".` };
  const editor = editorText === undefined || editorCommand === undefined ? undefined : { text: editorText, command: editorCommand };
  const vscode = values.vscode?.trim();
  if (vscode === '') return { ok: false, error: `Invalid --vscode value "${values.vscode}": expected the VS Code CLI that runs its web server — code-tunnel.exe of VS Code on Windows, code elsewhere.` };
  return { ok: true, command: { action: chosen[0] ?? 'serve', port, open: !values['no-open'], startMenu: values['start-menu'], palette, publicAddresses, herdr: values['no-herdr'] ? 'off' : 'on', claudeCommand, ...(claudeGptCommand === undefined ? {} : { claudeGptCommand }), ...(chatgptUsageFile === undefined ? {} : { chatgptUsageFile }), codexCommand, editor, vscode } };
}

/**
 * @param {string} text — a --public-url value
 * @returns {import('../server/app.js').PublicAddress | undefined} — none for anything but http(s)://host[:port][/]: the
 *   page is served from the root
 */
function publicAddressOf(text) {
  if (!URL.canParse(text)) return undefined;
  const url = new URL(text);
  const bare = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === '';
  return bare && (url.protocol === 'https:' || url.protocol === 'http:') ? { origin: url.origin, host: url.host } : undefined;
}

/** @param {readonly string[]} argv */
function parseOptions(argv) {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      port: { type: 'string', short: 'p', default: String(defaultPort) },
      palette: { type: 'string', default: 'clay' },
      'public-url': { type: 'string', multiple: true, default: [] },
      'no-open': { type: 'boolean', default: false },
      'no-herdr': { type: 'boolean', default: false },
      'claude-command': { type: 'string', default: 'claude' },
      'claude-gpt-command': { type: 'string' },
      'chatgpt-usage-file': { type: 'string' },
      'codex-command': { type: 'string', default: 'codex' },
      'editor-command': { type: 'string' },
      vscode: { type: 'string' },
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
