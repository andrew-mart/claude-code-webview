import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changePins, parsePinChange, parseSessionPins, scopesOf } from '../public/model/pins.js';

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
