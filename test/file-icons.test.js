import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconFor, parseIconTheme } from '../public/model/file-icons.js';

/** A theme's icons for a few names, as Material Icon Theme's manifest names them. */
/** @type {import('../public/model/file-icons.js').IconTheme} */
const theme = {
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
  fileNames: { 'package.json': 'nodejs', dockerfile: 'docker', '.gitignore': 'git' },
  fileExtensions: { ts: 'typescript', 'd.ts': 'typescript-def', 'test.ts': 'test-ts', md: 'markdown' },
  languageIds: { csharp: 'csharp', shellscript: 'console' },
  folderNames: { src: 'folder-src', test: 'folder-test' },
  folderNamesExpanded: { src: 'folder-src-open', test: 'folder-test-open' },
  light: { fileNames: { dockerfile: 'docker_light' }, fileExtensions: {}, folderNames: {}, folderNamesExpanded: {} },
};

// A file's icon as VS Code picks one from the theme: by its whole name, then by its longest extension the theme knows,
// then by its language, else the plain file; a folder's by its name, open or closed; the light theme's own where it has
// one
test('iconFor_Should_PickIconAsVsCodeDoes', () => {
  assert.deepEqual(
    [
      iconFor(theme, { name: 'Package.json', kind: 'file', open: false, light: false }),
      iconFor(theme, { name: 'limits.test.ts', kind: 'file', open: false, light: false }),
      iconFor(theme, { name: 'globals.d.ts', kind: 'file', open: false, light: false }),
      iconFor(theme, { name: 'limits.ts', kind: 'file', open: false, light: false }),
      iconFor(theme, { name: 'Orders.cs', kind: 'file', open: false, light: false }),
      iconFor(theme, { name: 'build.sh', kind: 'file', open: false, light: false }),
      iconFor(theme, { name: 'LICENSE', kind: 'file', open: false, light: false }),
      iconFor(theme, { name: 'notes.constructor', kind: 'file', open: false, light: false }),
      iconFor(theme, { name: 'Dockerfile', kind: 'file', open: false, light: true }),
      iconFor(theme, { name: 'src', kind: 'folder', open: false, light: false }),
      iconFor(theme, { name: 'src', kind: 'folder', open: true, light: false }),
      iconFor(theme, { name: 'docs', kind: 'folder', open: true, light: false }),
    ],
    ['nodejs', 'test-ts', 'typescript-def', 'typescript', 'csharp', 'console', 'file', 'file', 'docker_light', 'folder-src', 'folder-src-open', 'folder-open'],
  );
});

// The theme as the viewer sends it: what cannot be read in it is left out, a reply of another shape is none
test('parseIconTheme_Should_KeepWhatItCanRead', () => {
  const parsed = parseIconTheme({
    file: 'file',
    folder: 'folder',
    folderExpanded: 'folder-open',
    fileNames: { 'package.json': 'nodejs', odd: 3 },
    fileExtensions: { ts: 'typescript' },
    languageIds: {},
    folderNames: { src: 'folder-src' },
    folderNamesExpanded: { src: 'folder-src-open' },
    light: { fileNames: {}, fileExtensions: {}, folderNames: {}, folderNamesExpanded: {} },
  });

  assert.deepEqual(
    { names: parsed?.fileNames, other: parseIconTheme({ file: 'file' }) },
    { names: { 'package.json': 'nodejs' }, other: undefined },
  );
});
