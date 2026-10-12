// @ts-check
// Opening a file at a line in the editor of the computer the viewer runs on: the command it is started with
// (--editor-command), with places for the file, the line and the file's project.
import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

/**
 * @typedef {{ program: string, args: readonly string[] }} EditorCommand — args with the places {path}, {line}, {project}
 * @typedef {{ ok: true, program: string, args: readonly string[] } | { ok: false, error: 'not-a-file' | 'no-project' }} EditorLaunch
 * @typedef {{ ok: true } | { ok: false, error: 'not-a-file' | 'no-project' | 'not-started' }} EditorOutcome
 */

/** A folder with one of these is a project: a .NET solution, or a git repository (.git is a file in a worktree). */
const projectMarks = [/\.sln$/i, /\.slnx$/i, /^\.git$/];

/**
 * Words split at spaces; a word in double quotes keeps its spaces.
 * @param {string} command
 * @returns {EditorCommand | undefined} — none if it names no program or has no place for the file
 */
export function parseEditorCommand(command) {
  const words = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? '');
  const [program, ...args] = words;
  if (program === undefined || !args.some((arg) => arg.includes('{path}'))) return undefined;
  return { program, args };
}

/**
 * @param {EditorCommand} command
 * @param {string} path — absolute
 * @param {number} line
 * @returns {Promise<EditorLaunch>}
 */
export async function editorLaunch(command, path, line) {
  const isFile = await stat(path).then((found) => found.isFile(), () => false);
  if (!isFile) return { ok: false, error: 'not-a-file' };
  const needsProject = command.args.some((arg) => arg.includes('{project}'));
  const project = needsProject ? await projectOf(path) : undefined;
  if (needsProject && project === undefined) return { ok: false, error: 'no-project' };
  const places = new Map([
    ['path', path],
    ['line', String(line)],
  ]);
  if (project !== undefined) places.set('project', project);
  return { ok: true, program: command.program, args: command.args.map((arg) => arg.replace(/\{(path|line|project)\}/g, (place, name) => places.get(name) ?? place)) };
}

/**
 * The editor started apart from the viewer: it outlives it, and its output goes nowhere.
 * @param {EditorCommand} command
 * @param {string} path
 * @param {number} line
 * @returns {Promise<EditorOutcome>}
 */
export async function openInEditor(command, path, line) {
  const launch = await editorLaunch(command, path, line);
  if (!launch.ok) return launch;
  return new Promise((done) => {
    const child = spawn(launch.program, launch.args, { detached: true, stdio: 'ignore' });
    child.once('spawn', () => {
      child.unref();
      if (process.platform === 'win32') bringForward(launch.program);
      done({ ok: true });
    });
    child.once('error', () => done({ ok: false, error: 'not-started' }));
  });
}

/**
 * Windows keeps a window that a process in the background — the viewer started with --background — has the file opened
 * in behind the browser the button was pressed in: the editor's window is brought to the front, attaching for a moment
 * to the input of the window in front, as Windows lets a process do then. Tried for a while, as an editor that was not
 * running takes time to show its window; if it never does, nothing happens.
 * @param {string} program — the editor's program; its window is its process's main one
 */
function bringForward(program) {
  const name = basename(program).replace(/\.exe$/i, '');
  const script = `
Add-Type -Name Window -Namespace Viewer -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr window, System.IntPtr process);
[DllImport("kernel32.dll")] public static extern int GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(int from, int to, bool attach);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr window);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr window);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr window);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr window, int how);
'@
for ($try = 0; $try -lt 40; $try++) {
  Start-Sleep -Milliseconds 500
  $editor = Get-Process -Name '${name.replaceAll("'", "''")}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($editor -eq $null) { continue }
  $window = $editor.MainWindowHandle
  if ([Viewer.Window]::IsIconic($window)) { [void][Viewer.Window]::ShowWindow($window, 9) }
  $front = [Viewer.Window]::GetWindowThreadProcessId([Viewer.Window]::GetForegroundWindow(), [System.IntPtr]::Zero)
  $me = [Viewer.Window]::GetCurrentThreadId()
  [void][Viewer.Window]::AttachThreadInput($me, $front, $true)
  [void][Viewer.Window]::BringWindowToTop($window)
  $done = [Viewer.Window]::SetForegroundWindow($window)
  [void][Viewer.Window]::AttachThreadInput($me, $front, $false)
  if ($done) { break }
}`;
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => undefined).unref();
}

/**
 * @param {string} path
 * @returns {Promise<string | undefined>}
 */
async function projectOf(path) {
  for (let folder = dirname(path); ; folder = dirname(folder)) {
    const names = await readdir(folder).catch(() => []);
    if (names.some((name) => projectMarks.some((mark) => mark.test(name)))) return folder;
    if (dirname(folder) === folder) return undefined;
  }
}
