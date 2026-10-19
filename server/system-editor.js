// @ts-check
// "Open in the editor" with no editor given to the viewer, on Windows: the program Windows opens the kind of file with —
// as the user set it — opens it, at its line for the editors that take one. A kind of file whose program would run it
// is opened by the program set to edit it, or not at all.
import { execFile, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, extname, win32 } from 'node:path';
import { projectOf } from './editor.js';
import { workTreeOf } from './git.js';

/**
 * @typedef {{ open: string | undefined, edit: string | undefined }} Handlers — the programs Windows opens and edits a kind
 *   of file with, none where none is set
 * @typedef {{ kind: 'run', program: string, args: readonly string[] } | { kind: 'shell', program: string } | { kind: 'ask' } | { kind: 'runs-it' }} SystemLaunch —
 *   run: the program, given the file; shell: the file opened as a double click opens it; ask: no program is set for
 *   its kind — Windows asks which to open it with; runs-it: its program would run it, and none is set to edit it
 */

/** JetBrains' IDEs: a project, then --line and the file. */
const jetBrains = /^(rider|idea|webstorm|pycharm|goland|clion|rubymine|phpstorm|rustrover|datagrip|dataspell|aqua|writerside)(64)?\.exe$/i;
/** VS Code and its kin: a folder, then -g file:line. */
const vsCodes = /^(code|code - insiders|cursor|windsurf|vscodium)\.exe$/i;
/** Programs that run the file they are given: shells, script hosts, interpreters, regedit. */
const runners = /^(powershell|pwsh|cmd|wscript|cscript|mshta|pythonw?|pyw?|node|bash|sh|wsl|javaw?|rundll32|msiexec|regedit|conhost|wt|windowsterminal|hh)\.exe$/i;
/** Kinds of file Windows runs, whatever program it names for them. */
const runKinds = new Set(['.exe', '.com', '.scr', '.msi', '.msp', '.lnk', '.cpl', '.pif', '.application', '.appref-ms', '.url', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.jse', '.wsf', '.wsh', '.hta', '.reg']);

/**
 * @param {{ path: string, line: number, handlers: Handlers, project: string | undefined, workTree: string | undefined }} file —
 *   project: the nearest folder above with a .NET solution or a git repository, for a JetBrains IDE; workTree: the git
 *   work tree, for VS Code
 * @returns {SystemLaunch}
 */
export function systemLaunch(file) {
  const { path, handlers } = file;
  const runs = runKinds.has(win32.extname(path).toLowerCase()) || (handlers.open !== undefined && runners.test(win32.basename(handlers.open)));
  if (runs) {
    if (handlers.edit === undefined || runners.test(win32.basename(handlers.edit))) return { kind: 'runs-it' };
    return { kind: 'run', program: handlers.edit, args: editorArgs(handlers.edit, file) ?? [path] };
  }
  if (handlers.open === undefined) return { kind: 'ask' };
  const args = editorArgs(handlers.open, file);
  return args === undefined ? { kind: 'shell', program: handlers.open } : { kind: 'run', program: handlers.open, args };
}

/**
 * @param {{ handlersOf: (kind: string) => Promise<Handlers>, run: (program: string, args: readonly string[]) => Promise<boolean>, openAsShell: (path: string) => Promise<boolean>, bringForward: (name: string) => void }} parts —
 *   handlersOf: the programs set for a kind of file, by its extension in lower case; run: a program started apart from
 *   the viewer, whether it started; openAsShell: the file opened as a double click opens it; bringForward: a program's
 *   window brought before its user, by its process's name
 * @returns {import('./app.js').OpenEditor}
 */
export function createSystemEditor({ handlersOf, run, openAsShell, bringForward }) {
  /** @param {string} program @param {boolean} started @returns {import('./editor.js').EditorOutcome} */
  const shown = (program, started) => {
    if (!started) return { ok: false, error: 'not-started' };
    bringForward(win32.basename(program).replace(/\.exe$/i, ''));
    return { ok: true };
  };
  return async (path, line) => {
    if (!(await stat(path).then((found) => found.isFile(), () => false))) return { ok: false, error: 'not-a-file' };
    const handlers = await handlersOf(extname(path).toLowerCase());
    const launch = systemLaunch({ path, line, handlers, project: await projectOf(path), workTree: await workTreeOf(dirname(path)) });
    switch (launch.kind) {
      case 'runs-it':
        return { ok: false, error: 'runs-it' };
      case 'ask':
        return shown('OpenWith.exe', await run('OpenWith.exe', [path]));
      case 'shell':
        return shown(launch.program, await openAsShell(path));
      case 'run':
        return shown(launch.program, await run(launch.program, launch.args));
      default:
        return launch;
    }
  };
}

/**
 * How an editor that takes a line is given the file at it; none for another program.
 * @param {string} program
 * @param {{ path: string, line: number, project: string | undefined, workTree: string | undefined }} file
 * @returns {readonly string[] | undefined}
 */
function editorArgs(program, { path, line, project, workTree }) {
  const name = win32.basename(program);
  if (jetBrains.test(name)) return [...(project === undefined ? [] : [project]), '--line', String(line), path];
  if (vsCodes.test(name)) return [...(workTree === undefined ? [] : [workTree]), '-g', `${path}:${line}`];
  if (/^notepad\+\+\.exe$/i.test(name)) return [`-n${line}`, path];
  if (/^sublime_text\.exe$/i.test(name)) return [`${path}:${line}`];
  return undefined;
}

/**
 * The programs Windows opens and edits a kind of file with, as Explorer would: asked of the shell (AssocQueryString,
 * the program's path for the open and edit verbs).
 * @param {string} kind — the extension, its dot first, in lower case
 * @returns {Promise<Handlers>}
 */
export async function windowsHandlers(kind) {
  if (!/^\.[\w+-]{1,20}$/.test(kind)) return { open: undefined, edit: undefined };
  const script = `$ProgressPreference = 'SilentlyContinue'
Add-Type -Namespace Viewer -Name Assoc -MemberDefinition '[DllImport("Shlwapi.dll", CharSet = CharSet.Unicode)] public static extern uint AssocQueryString(int flags, int str, string assoc, string extra, System.Text.StringBuilder outText, ref uint outLength);'
foreach ($verb in @('open', 'edit')) {
  $length = [uint32]2048
  $text = New-Object System.Text.StringBuilder 2048
  $found = [Viewer.Assoc]::AssocQueryString(0, 2, '${kind}', $verb, $text, [ref]$length)
  if ($found -eq 0) { $verb + '=' + $text.ToString() } else { $verb + '=' }
}`;
  const output = await powershell(script);
  /** @param {'open' | 'edit'} verb */
  const program = (verb) => new RegExp(`^${verb}=(.+?)\\r?$`, 'm').exec(output)?.[1];
  return { open: program('open'), edit: program('edit') };
}

/**
 * The file opened as a double click in Explorer opens it.
 * @param {string} path
 * @returns {Promise<boolean>} — whether Windows took it
 */
export async function shellOpen(path) {
  const literal = `'${path.replaceAll("'", "''")}'`;
  const output = await powershell(`$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = ${literal}
$start.UseShellExecute = $true
[void][System.Diagnostics.Process]::Start($start)
'started'`);
  return output.includes('started');
}

/**
 * A program started apart from the viewer: it outlives it, and its output goes nowhere.
 * @param {string} program
 * @param {readonly string[]} args
 * @returns {Promise<boolean>} — whether it started
 */
export function startApart(program, args) {
  return new Promise((done) => {
    const child = spawn(program, args, { detached: true, stdio: 'ignore' });
    child.once('spawn', () => {
      child.unref();
      done(true);
    });
    child.once('error', () => done(false));
  });
}

/**
 * What a PowerShell script writes; nothing when it fails.
 * @param {string} script
 * @returns {Promise<string>}
 */
function powershell(script) {
  return new Promise((done) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20_000 }, (error, stdout) => done(error === null ? String(stdout) : ''));
  });
}
