import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileLinks } from '../server/links.js';

const limits = { home: tmpdir(), maxMatches: 100, maxBytes: 100_000 };

/** A project folder of files by their paths from it, kept by git. @param {Record<string, string>} files */
async function project(files) {
  const root = await mkdtemp(join(tmpdir(), 'csv-links-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

// A file's links: what it imports — a file of the project found by the import's path, as the language finds it, or
// left unfound, a package — and the files that import it
test('fileLinks_Should_TellWhatFileImports_And_WhatImportsIt', async () => {
  const root = await project({
    'src/limits.ts': ["import { clock } from './clock.js';", "import type { Rule } from './rules';", "import express from 'express';", "export { allow } from '../lib/allow';", ''].join('\n'),
    'src/clock.ts': 'export const clock = () => Date.now();\n',
    'src/rules/index.ts': 'export type Rule = {};\n',
    'lib/allow.js': 'export function allow() {}\n',
    'src/app.ts': "import { limits } from './limits';\nconst again = require('./limits.ts');\n",
    'docs/notes.md': 'See [the limits](../src/limits.ts) and [the site](https://example.com).\n',
    'src/other.ts': "import { limits } from './limits-old';\n",
  });
  const relative = (/** @type {string | undefined} */ path) => (path === undefined ? undefined : path.slice(root.length + 1).replaceAll('\\', '/'));

  const links = await fileLinks(join(root, 'src', 'limits.ts'), root, limits);

  assert.ok(links.ok);
  assert.deepEqual(
    {
      imports: links.imports.map((link) => ({ line: link.line, spec: link.spec, path: relative(link.path) })),
      importedBy: links.importedBy.map((link) => `${relative(link.path)}:${link.line}`).sort(),
    },
    {
      imports: [
        { line: 1, spec: './clock.js', path: 'src/clock.ts' },
        { line: 2, spec: './rules', path: 'src/rules/index.ts' },
        { line: 3, spec: 'express', path: undefined },
        { line: 4, spec: '../lib/allow', path: 'lib/allow.js' },
      ],
      importedBy: ['docs/notes.md:1', 'src/app.ts:1', 'src/app.ts:2'],
    },
  );
});

// Each language's imports lead where the language finds them: Python's relative and absolute modules, Rust's mod, C's
// quoted include, CSS's import, a Markdown link with a space in it
test('fileLinks_Should_FindImportsAsEachLanguageWritesThem', async () => {
  const root = await project({
    'app/main.py': 'from .db import connect\nimport app.models\n',
    'app/db.py': '',
    'app/models/__init__.py': '',
    'src/main.rs': 'mod limits;\npub mod rules;\n',
    'src/limits.rs': '',
    'src/rules/mod.rs': '',
    'src/clock.c': '#include "clock.h"\n#include <stdio.h>\n',
    'src/clock.h': '',
    'web/site.css': "@import 'reset.css';\n",
    'web/reset.css': '',
    'docs/a.md': '[setup](./set%20up.md)\n',
    'docs/set up.md': '',
  });
  /** @param {string} file */
  const leads = async (file) => {
    const links = await fileLinks(join(root, file), root, limits);
    assert.ok(links.ok);
    return links.imports.map((link) => link.path?.slice(root.length + 1).replaceAll('\\', '/'));
  };

  assert.deepEqual(
    { python: await leads('app/main.py'), rust: await leads('src/main.rs'), c: await leads('src/clock.c'), css: await leads('web/site.css'), markdown: await leads('docs/a.md') },
    { python: ['app/db.py', 'app/models/__init__.py'], rust: ['src/limits.rs', 'src/rules/mod.rs'], c: ['src/clock.h'], css: ['web/reset.css'], markdown: ['docs/set up.md'] },
  );
});
