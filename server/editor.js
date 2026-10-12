// @ts-check
// Opening a file at a line in the editor of the computer the viewer runs on: the command it is started with
// (--editor-command), with places for the file, the line and the file's project.
import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

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
      done({ ok: true });
    });
    child.once('error', () => done({ ok: false, error: 'not-started' }));
  });
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
