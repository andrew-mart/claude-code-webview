import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createSystemEditor, systemLaunch } from '../server/system-editor.js';

const rider = 'D:\\JetBrains\\Rider\\bin\\rider64.exe';
const code = 'C:\\Users\\ann\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
const notepadPlus = 'C:\\Program Files\\Notepad++\\notepad++.exe';
const sublime = 'C:\\Program Files\\Sublime Text\\sublime_text.exe';
const typora = 'C:\\Program Files\\Typora\\Typora.exe';
const notepad = 'C:\\WINDOWS\\system32\\NOTEPAD.EXE';
const ise = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell_ise.exe';
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const project = 'D:\\dev\\shop';
const workTree = 'D:\\dev\\shop';

/** @param {string} path @param {string | undefined} open @param {string | undefined} edit */
const launch = (path, open, edit = undefined) => systemLaunch({ path, line: 12, handlers: { open, edit }, project, workTree });

// The program Windows opens a kind of file with opens it — at its line, for the editors that take one: Rider and the
// other JetBrains IDEs in the file's project (a .NET solution's folder), VS Code in its git work tree, Notepad++ and
// Sublime Text by their own ways; another program as a double click opens it; a kind with no program set leaves
// Windows to ask which
test('systemLaunch_Should_OpenFileWithProgramSetForItsKind_AtItsLineWhereProgramTakesOne', () => {
  assert.deepEqual(
    [
      launch('D:\\dev\\shop\\src\\Cart.cs', rider),
      launch('D:\\dev\\shop\\web\\app.js', code),
      launch('D:\\dev\\shop\\appsettings.json', notepadPlus),
      launch('D:\\dev\\shop\\notes.txt', sublime),
      launch('D:\\dev\\shop\\README.md', typora),
      launch('D:\\dev\\shop\\web\\app.ts', undefined, notepad),
    ],
    [
      { kind: 'run', program: rider, args: [project, '--line', '12', 'D:\\dev\\shop\\src\\Cart.cs'] },
      { kind: 'run', program: code, args: [workTree, '-g', 'D:\\dev\\shop\\web\\app.js:12'] },
      { kind: 'run', program: notepadPlus, args: ['-n12', 'D:\\dev\\shop\\appsettings.json'] },
      { kind: 'run', program: sublime, args: ['D:\\dev\\shop\\notes.txt:12'] },
      { kind: 'shell', program: typora },
      { kind: 'ask' },
    ],
  );
});

// A kind of file its program runs — a script host, a shell, regedit, or a kind Windows always runs — is not run: the
// program set to edit it opens it, and with none it opens nothing
test('systemLaunch_Should_EditFileItsProgramWouldRun_AndOpenNothingWithNoEditorSet', () => {
  assert.deepEqual(
    [
      launch('D:\\dev\\shop\\build.ps1', powershell, ise),
      launch('D:\\dev\\shop\\deploy.bat', undefined, notepad),
      launch('D:\\dev\\shop\\tool.py', 'C:\\Python312\\python.exe', undefined),
      launch('D:\\dev\\shop\\keys.reg', 'C:\\Windows\\regedit.exe', notepadPlus),
      launch('D:\\dev\\shop\\setup.exe', 'D:\\dev\\shop\\setup.exe', undefined),
    ],
    [
      { kind: 'run', program: ise, args: ['D:\\dev\\shop\\build.ps1'] },
      { kind: 'run', program: notepad, args: ['D:\\dev\\shop\\deploy.bat'] },
      { kind: 'runs-it' },
      { kind: 'run', program: notepadPlus, args: ['-n12', 'D:\\dev\\shop\\keys.reg'] },
      { kind: 'runs-it' },
    ],
  );
});

// The programs set for the file's kind are looked up, its project found — the folder with its .NET solution — and the
// file opened, the program brought before its user; with no program set Windows asks which; a file its program would
// run opens nothing, nor does one not there
test('systemEditor_Should_OpenFileThroughProgramSetForItsKind_InItsProject', async () => {
  const shop = join(tempDir('system-editor-'), 'shop');
  await mkdir(join(shop, 'src'), { recursive: true });
  await writeFile(join(shop, 'Shop.sln'), '');
  const files = { cs: join(shop, 'src', 'Cart.cs'), md: join(shop, 'README.md'), ts: join(shop, 'src', 'app.ts'), ps1: join(shop, 'build.ps1') };
  for (const file of Object.values(files)) await writeFile(file, 'x\n');
  /** @type {Readonly<Record<string, import('../server/system-editor.js').Handlers>>} */
  const set = { '.cs': { open: rider, edit: notepad }, '.md': { open: typora, edit: undefined }, '.ps1': { open: powershell, edit: undefined } };
  /** @type {string[][]} */
  const did = [];
  const open = createSystemEditor({
    handlersOf: async (kind) => set[kind] ?? { open: undefined, edit: undefined },
    run: async (program, args) => {
      did.push(['run', program, ...args]);
      return true;
    },
    openAsShell: async (path) => {
      did.push(['shell', path]);
      return true;
    },
    bringForward: (name) => void did.push(['front', name]),
  });

  const outcomes = [await open(files.cs, 21), await open(files.md, 1), await open(files.ts, 1), await open(files.ps1, 1), await open(join(shop, 'gone.cs'), 1)];

  assert.deepEqual(
    { outcomes, did },
    {
      outcomes: [{ ok: true }, { ok: true }, { ok: true }, { ok: false, error: 'runs-it' }, { ok: false, error: 'not-a-file' }],
      did: [['run', rider, shop, '--line', '21', files.cs], ['front', 'rider64'], ['shell', files.md], ['front', 'Typora'], ['run', 'OpenWith.exe', files.ts], ['front', 'OpenWith']],
    },
  );
});

// Out of a project — no solution, no git repository above the file — an editor opens the file alone
test('systemLaunch_Should_OpenFileAlone_When_ItIsInNoProject', () => {
  const loose = 'D:\\notes\\todo.cs';
  assert.deepEqual(
    [systemLaunch({ path: loose, line: 3, handlers: { open: rider, edit: undefined }, project: undefined, workTree: undefined }), systemLaunch({ path: loose, line: 3, handlers: { open: code, edit: undefined }, project: undefined, workTree: undefined })],
    [
      { kind: 'run', program: rider, args: ['--line', '3', loose] },
      { kind: 'run', program: code, args: ['-g', `${loose}:3`] },
    ],
  );
});
