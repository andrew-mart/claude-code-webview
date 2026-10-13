import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranchChanges, parseFileDiff } from '../public/model/branch-changes.js';

const reply = {
  ok: true,
  root: 'D:/dev/shop',
  branch: 'feat',
  base: { name: 'main', sha: 'a'.repeat(40), how: 'made-from' },
  commits: [{ sha: 'b'.repeat(40), subject: 'feat: limits' }],
  files: [
    { path: 'src/limits.ts', status: 'modified', added: 12, removed: 3 },
    { path: 'src/rate.ts', oldPath: 'src/old-rate.ts', status: 'renamed', added: 1, removed: 1 },
    { path: 'logo.png', status: 'modified' },
    { path: 'odd.txt', status: 'exploded' },
  ],
  branches: ['main', 'feat', 7],
};

// The changes come as the server sends them; what cannot be read — a status not known, a branch not named — is left out
test('parseBranchChanges_Should_TakeReplyAsServerSendsIt_LeavingOutWhatItCannotRead', () => {
  assert.deepEqual(parseBranchChanges(JSON.parse(JSON.stringify(reply))), {
    ok: true,
    root: 'D:/dev/shop',
    branch: 'feat',
    base: { name: 'main', sha: 'a'.repeat(40), how: 'made-from' },
    commits: [{ sha: 'b'.repeat(40), subject: 'feat: limits' }],
    files: [
      { path: 'src/limits.ts', oldPath: undefined, status: 'modified', added: 12, removed: 3 },
      { path: 'src/rate.ts', oldPath: 'src/old-rate.ts', status: 'renamed', added: 1, removed: 1 },
      { path: 'logo.png', oldPath: undefined, status: 'modified', added: undefined, removed: undefined },
    ],
    branches: ['main', 'feat'],
  });
});

// A refusal is told as it is; a reply of another shape — a page newer than the server, a proxy's error — is none
test('parseBranchChanges_Should_TellRefusal_And_GiveNothingForOtherShapes', () => {
  assert.deepEqual(
    [parseBranchChanges({ ok: false, error: 'not-a-repository' }), parseBranchChanges({ ok: true, root: 'D:/x' }), parseBranchChanges('<html>'), parseBranchChanges({ ...reply, base: { name: 'main', sha: 'x', how: 'guessed' } })],
    [{ ok: false, error: 'not-a-repository' }, undefined, undefined, undefined],
  );
});

// A file's diff: its rows as the server numbered them, a row it cannot read left out; a binary file says so
test('parseFileDiff_Should_TakeRows_And_SayBinary', () => {
  assert.deepEqual(
    [
      parseFileDiff({ ok: true, binary: false, rows: [{ kind: 'ctx', oldNo: 1, newNo: 1, text: 'a' }, { kind: 'add', newNo: 2, text: 'b' }, { kind: 'moved', text: 'c' }] }),
      parseFileDiff({ ok: true, binary: true, rows: [] }),
      parseFileDiff({ ok: false, error: 'not-in-repository' }),
      parseFileDiff(undefined),
    ],
    [
      { ok: true, binary: false, rows: [{ kind: 'ctx', oldNo: 1, newNo: 1, text: 'a' }, { kind: 'add', oldNo: undefined, newNo: 2, text: 'b' }] },
      { ok: true, binary: true, rows: [] },
      { ok: false, error: 'not-in-repository' },
      undefined,
    ],
  );
});
