import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changePins, parsePinChange, parsePins, parseSessionPins, pinLabel, scopesOf } from '../public/model/pins.js';

/** @typedef {import('../public/model/pins.js').Pin} Pin */

/** @type {Pin} */
const spec = { path: 'D:\\dev\\shop\\docs\\spec.md', at: '2026-10-28T09:00:00.000Z' };
/** @type {Pin} */
const design = { path: 'D:\\dev\\shop\\docs\\design.pdf', at: '2026-10-28T09:05:00.000Z' };

// A file pinned goes first, once — the same file however its slashes lean, a Windows path in any case; unpinned, it is
// gone however it is written
test('changePins_Should_PinFileFirstOnce_AndUnpinItHoweverItIsWritten', () => {
  const pinned = changePins(changePins([spec], { action: 'add', pin: design }), { action: 'add', pin: { ...design, path: 'd:/DEV/shop/docs/design.pdf' } });

  assert.deepEqual(
    { pinned, unpinned: changePins(pinned, { action: 'remove', path: 'D:/dev/shop/docs/spec.md' }) },
    { pinned: [design, spec], unpinned: [design] },
  );
});

// Where a file is pinned: to the session's project folder, to the session, both or neither
test('scopesOf_Should_TellWhereFileIsPinned', () => {
  const pins = { folder: [spec], session: [spec, design] };

  assert.deepEqual(
    [scopesOf(pins, 'd:/dev/shop/docs/spec.md'), scopesOf(pins, design.path), scopesOf(pins, 'D:\\dev\\shop\\README.md')],
    [['folder', 'session'], ['session'], []],
  );
});

// The viewer's reply and the page's change, read as they are or not at all: a pin of another shape is left out
test('parseSessionPins_And_parsePinChange_Should_ReadOnlyWellFormed', () => {
  assert.deepEqual(
    {
      reply: parseSessionPins({ folder: [spec, { path: 7 }], session: 'junk' }),
      none: parseSessionPins('a proxy error page'),
      changes: [
        parsePinChange({ action: 'add', pin: spec }),
        parsePinChange({ action: 'remove', path: spec.path }),
        parsePinChange({ action: 'add', pin: { path: '' } }),
        parsePinChange({ action: 'drop', path: spec.path }),
      ],
    },
    {
      reply: { folder: [spec], session: [] },
      none: { folder: [], session: [] },
      changes: [{ action: 'add', pin: spec }, { action: 'remove', path: spec.path }, undefined, undefined],
    },
  );
});

// A pinned file may be named in the list as one likes, its file's own name unchanged: the name given — without the spaces
// around it — else the file's name; a blank name gives the file's back. The name goes with the pin, to the server and
// back, the change naming it found however the path is written
test('changePins_Should_NamePinnedFileByHand_AndPinLabelShowIt', () => {
  const named = changePins([spec, design], { action: 'name', path: 'd:/dev/shop/docs/spec.md', name: ' Spec v2 ' });
  const unnamed = changePins(named, { action: 'name', path: spec.path, name: '  ' });

  assert.deepEqual(
    {
      labels: [named, unnamed].map((list) => list.map(pinLabel)),
      stored: parsePins([{ ...spec, name: ' Spec v2 ' }, { ...design, name: 3 }]),
      change: parsePinChange({ action: 'name', path: spec.path, name: 'Spec v2' }),
    },
    {
      labels: [['Spec v2', 'design.pdf'], ['spec.md', 'design.pdf']],
      stored: [{ ...spec, name: 'Spec v2' }, design],
      change: { action: 'name', path: spec.path, name: 'Spec v2' },
    },
  );
});
