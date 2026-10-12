import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorLaunch, parseEditorCommand } from '../server/editor.js';

// The editor's command is set once, with places for the file, its line and its project — the nearest folder above
// with a solution or a git repository (Rider takes a line only after the project); each fills one argument whatever
// spaces it has
test('editorLaunch_Should_FillFileLineAndProjectIntoCommand', async () => {
  const root = await mkdtemp(join(tmpdir(), 'editor-'));
  const project = join(root, 'My App');
  await mkdir(join(project, 'src', 'Domain'), { recursive: true });
  await writeFile(join(project, 'App.sln'), '');
  const file = join(project, 'src', 'Domain', 'User Types.cs');
  await writeFile(file, 'class UserTypes {}');
  const loose = join(root, 'notes.txt');
  await writeFile(loose, '');
  const rider = parseEditorCommand('"D:/Jet Brains/rider64.exe" {project} --line {line} {path}');
  const code = parseEditorCommand('code --goto {path}:{line}');
  if (rider === undefined || code === undefined) throw new Error('the commands did not parse');

  assert.deepEqual(
    [await editorLaunch(rider, file, 21), await editorLaunch(code, file, 7), await editorLaunch(rider, loose, 1), await editorLaunch(code, join(root, 'gone.cs'), 1)],
    [
      { ok: true, program: 'D:/Jet Brains/rider64.exe', args: [project, '--line', '21', file] },
      { ok: true, program: 'code', args: ['--goto', `${file}:7`] },
      { ok: false, error: 'no-project' },
      { ok: false, error: 'not-a-file' },
    ],
  );
});

// A command without a place for the file opens nothing in particular: it is not taken
test('parseEditorCommand_Should_TakeCommandNamingFile_Only', () => {
  assert.deepEqual([parseEditorCommand('  '), parseEditorCommand('rider64.exe --line {line}'), parseEditorCommand('subl {path}:{line}')], [
    undefined,
    undefined,
    { program: 'subl', args: ['{path}:{line}'] },
  ]);
});
