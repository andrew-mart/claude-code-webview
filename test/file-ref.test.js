import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileRefFromHref, findFileRefs } from '../public/model/file-ref.js';

test('findFileRefs_Should_FindAbsolutePathWithLine', () => {
  assert.deepEqual(findFileRefs('see D:/dev/app/Moderation/ModerationService.cs:212 — there'), [
    { index: 4, text: 'D:/dev/app/Moderation/ModerationService.cs:212', path: 'D:/dev/app/Moderation/ModerationService.cs', line: 212, endLine: undefined },
  ]);
});

test('findFileRefs_Should_LeaveSentenceDotAndBracketsOutsideOfPath', () => {
  assert.deepEqual(
    findFileRefs('File D:\\dev\\x\\a.md. Also (D:/dev/x/b.js:5) and (D:/dev/x/c.js).').map((ref) => ref.text),
    ['D:\\dev\\x\\a.md', 'D:/dev/x/b.js:5', 'D:/dev/x/c.js'],
  );
});

test('findFileRefs_Should_ReadLineRangeAndIgnoreColumn', () => {
  assert.deepEqual(
    findFileRefs('D:/a/b.cs:10-20 and D:/a/c.cs:7:3').map(({ path, line, endLine }) => ({ path, line, endLine })),
    [
      { path: 'D:/a/b.cs', line: 10, endLine: 20 },
      { path: 'D:/a/c.cs', line: 7, endLine: undefined },
    ],
  );
});

test('fileRefFromHref_Should_ReadFileUrlWithEscapedSpacesAndLine', () => {
  assert.deepEqual(
    ['file:///D:/dev/x%20y/z.md', 'file:///D:/dev/a.cs#L42', 'file:///D:/dev/a.cs:42-50', 'https://example.com/a.cs'].map(fileRefFromHref),
    [
      { path: 'D:/dev/x y/z.md', line: undefined, endLine: undefined },
      { path: 'D:/dev/a.cs', line: 42, endLine: undefined },
      { path: 'D:/dev/a.cs', line: 42, endLine: 50 },
      undefined,
    ],
  );
});

test('findFileRefs_Should_FindMacAndLinuxPathsUnderKnownRootsAndHome', () => {
  assert.deepEqual(
    findFileRefs('See /Users/ann/shop/src/app.ts:12, `/home/dev/api/main.go` and ~/notes/todo.md.').map(({ path, line }) => ({ path, line })),
    [
      { path: '/Users/ann/shop/src/app.ts', line: 12 },
      { path: '/home/dev/api/main.go', line: undefined },
      { path: '~/notes/todo.md', line: undefined },
    ],
  );
});

test('findFileRefs_Should_LeaveUrlPathsAndRelativePathsAlone', () => {
  assert.deepEqual(findFileRefs('GET /api/health, https://example.com/home/a.js, src/home/b.js and /vendor/marked.js'), []);
});

test('fileRefFromHref_Should_ReadPosixFileUrl', () => {
  assert.deepEqual(fileRefFromHref('file:///Users/ann/My%20App/a.ts#L3'), { path: '/Users/ann/My App/a.ts', line: 3, endLine: undefined });
});

test('findFileRefs_Should_IgnoreUrlsTimesAndBareDrive', () => {
  assert.deepEqual(findFileRefs('https://example.com/a:80, at 10:30, ratio 1:2, drive C: and http://x/D:/y'), []);
});

test('findFileRefs_Should_LeaveClosingQuotesOutsideOfPath', () => {
  assert.deepEqual(
    findFileRefs('See «D:/dev/app/a.js», “C:/repo/b.cs:12” and ‘/home/ann/c.md’.').map(({ path, line }) => ({ path, line })),
    [
      { path: 'D:/dev/app/a.js', line: undefined },
      { path: 'C:/repo/b.cs', line: 12 },
      { path: '/home/ann/c.md', line: undefined },
    ],
  );
});

// A file whose name has spaces is one reference up to its extension and line — in a sentence, a heading or inline code;
// a folder followed by words, or a file followed by other words, keeps the spaces out
test('findFileRefs_Should_TakeFileNameWithSpaces_UpToItsExtension', () => {
  assert.deepEqual(
    [
      'Отметить пункты 5–6 в D:/dev/acme/local-docs/kiwi/Замечания после ревью.md:40 и ответить',
      'D:/dev/acme/local-docs/kiwi/Замечания после ревью.md',
      'See ~/notes/My Plan.md.',
      'D:/dev/app/a.md and b.md',
      'in D:/dev/app then go home',
    ].map((source) => findFileRefs(source).map(({ text, path, line }) => ({ text, path, line }))),
    [
      [{ text: 'D:/dev/acme/local-docs/kiwi/Замечания после ревью.md:40', path: 'D:/dev/acme/local-docs/kiwi/Замечания после ревью.md', line: 40 }],
      [{ text: 'D:/dev/acme/local-docs/kiwi/Замечания после ревью.md', path: 'D:/dev/acme/local-docs/kiwi/Замечания после ревью.md', line: undefined }],
      [{ text: '~/notes/My Plan.md', path: '~/notes/My Plan.md', line: undefined }],
      [{ text: 'D:/dev/app/a.md', path: 'D:/dev/app/a.md', line: undefined }],
      [{ text: 'D:/dev/app', path: 'D:/dev/app', line: undefined }],
    ],
  );
});
