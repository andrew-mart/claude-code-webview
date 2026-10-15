import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFolder, searchProject } from '../server/project.js';

const limits = { home: tmpdir(), maxEntries: 100, maxMatches: 100, timeoutMs: 20_000 };

/** A project folder of files by their paths from it. @param {Record<string, string>} files */
async function project(files) {
  const root = await mkdtemp(join(tmpdir(), 'csv-project-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

// A folder of the project shows its folders first, then its files, each by name as a person sorts them — 2 before 10
// — and not git's own folder
test('listFolder_Should_ListFoldersThenFilesByName_WithoutGitsOwnFolder', async () => {
  const root = await project({ 'src/a.ts': '', 'docs/x.md': '', '.git/HEAD': '', 'README.md': '', 'b10.txt': '', 'b2.txt': '', '.env': '' });

  const listed = await listFolder(root, limits);

  assert.deepEqual(listed.ok && listed.entries, [
    { name: 'docs', kind: 'folder' },
    { name: 'src', kind: 'folder' },
    { name: '.env', kind: 'file' },
    { name: 'b2.txt', kind: 'file' },
    { name: 'b10.txt', kind: 'file' },
    { name: 'README.md', kind: 'file' },
  ]);
});

// The project's text is searched as git sees it — its files and new ones, not what it ignores — each match with its
// file, line, column and the line's text; the search tells words, case and patterns apart when asked
test('searchProject_Should_FindTextInProjectsFiles_ButNotIgnoredOnes_ByTheWayAsked', async () => {
  const root = await project({
    '.gitignore': 'node_modules\n',
    'src/limits.ts': 'export const perSecond = 10;\nconst perSecondMax = 20;\n',
    'docs/notes.md': 'PERSECOND is set in limits\n',
    'node_modules/lib/index.js': 'perSecond\n',
  });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.gitignore', 'src/limits.ts'], { cwd: root });
  /** @param {Partial<import('../server/project.js').SearchQuery>} asked */
  const found = async (asked) => {
    const searched = await searchProject(root, { text: 'perSecond', mode: 'text', caseSensitive: false, wholeWord: false, ...asked }, limits);
    return searched.ok ? searched.matches.map(({ path, line, column, text }) => `${path.slice(root.length + 1).replaceAll('\\', '/')}:${line}:${column} ${text}`).sort() : searched;
  };

  assert.deepEqual(
    { any: await found({}), cased: await found({ caseSensitive: true }), word: await found({ wholeWord: true }), pattern: await found({ text: 'perSecond(Max)? =', mode: 'regex' }) },
    {
      any: ['docs/notes.md:1:1 PERSECOND is set in limits', 'src/limits.ts:1:14 export const perSecond = 10;', 'src/limits.ts:2:7 const perSecondMax = 20;'],
      cased: ['src/limits.ts:1:14 export const perSecond = 10;', 'src/limits.ts:2:7 const perSecondMax = 20;'],
      word: ['docs/notes.md:1:1 PERSECOND is set in limits', 'src/limits.ts:1:14 export const perSecond = 10;'],
      pattern: ['src/limits.ts:1:14 export const perSecond = 10;', 'src/limits.ts:2:7 const perSecondMax = 20;'],
    },
  );
});

// A folder git does not keep is searched too; a search stops at its limit and says there is more; a pattern that is
// none is refused
test('searchProject_Should_SearchFolderOutsideRepository_StopAtLimit_AndRefuseBrokenPattern', async () => {
  const root = await project({ 'a.md': 'limit one\nlimit two\n', 'b.md': 'limit three\n' });
  const limited = { ...limits, maxMatches: 2 };

  const all = await searchProject(root, { text: 'limit', mode: 'text', caseSensitive: false, wholeWord: false }, limits);
  const first = await searchProject(root, { text: 'limit', mode: 'text', caseSensitive: false, wholeWord: false }, limited);
  const broken = await searchProject(root, { text: 'limit(', mode: 'regex', caseSensitive: false, wholeWord: false }, limits);

  assert.deepEqual(
    { all: all.ok && { found: all.matches.length, more: all.more }, first: first.ok && { found: first.matches.length, more: first.more }, broken },
    { all: { found: 3, more: false }, first: { found: 2, more: true }, broken: { ok: false, error: 'bad-pattern' } },
  );
});

// A search cut short by its time — a big project — says there may be more, not that it found all there is
test('searchProject_Should_SayThereMayBeMore_When_CutShortByItsTime', async () => {
  const root = await project({ 'a.md': 'limit one\n' });

  const cut = await searchProject(root, { text: 'limit', mode: 'text', caseSensitive: false, wholeWord: false }, { ...limits, timeoutMs: 0 });

  assert.deepEqual(cut.ok && cut.more, true);
});
