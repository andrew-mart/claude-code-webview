import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJoined } from '../server/joined.js';

// Files read as one: a part that ends early is read up to its end, the next one right after — a read across the seam
// gets both sides of it
test('openJoined_Should_ReadPartsAsOneFile_EachUpToItsEnd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-joined-'));
  await writeFile(join(dir, 'first.jsonl'), 'a1\na2\nleft\n');
  await writeFile(join(dir, 'second.jsonl'), 'b1\n');
  const joined = await openJoined([
    { path: join(dir, 'first.jsonl'), end: 6 },
    { path: join(dir, 'second.jsonl'), end: undefined },
  ]);
  try {
    const whole = Buffer.alloc(joined.size);
    const across = Buffer.alloc(4);
    const wholeRead = await joined.read(whole, 0);
    const acrossRead = await joined.read(across, 3);

    assert.deepEqual(
      { size: joined.size, whole: whole.subarray(0, wholeRead).toString(), across: across.subarray(0, acrossRead).toString() },
      { size: 9, whole: 'a1\na2\nb1\n', across: 'a2\nb' },
    );
  } finally {
    await joined.close();
  }
});
