import { test } from 'node:test';
import assert from 'node:assert/strict';

// the store listens for the window's focus; nothing else of a page is needed
Object.assign(globalThis, { window: { addEventListener: () => undefined, removeEventListener: () => undefined } });
const { createNotesStore } = await import('../public/view/notes-store.js');

/**
 * A store whose requests wait until answered by hand, and the notes it shows each time, by their texts.
 */
function storeAnsweredByHand() {
  /** @type {{ what: string, change: Record<string, unknown> | undefined, answer: (json: unknown) => Promise<void> }[]} */
  const asked = [];
  globalThis.fetch = async (url, init) =>
    new Promise((resolve) => {
      const change = typeof init?.body === 'string' ? JSON.parse(init.body).change : undefined;
      asked.push({
        what: change?.action ?? (String(url).includes('/history') ? 'history' : 'list'),
        change,
        answer: async (json) => {
          resolve(new Response(JSON.stringify(json)));
          await new Promise((settled) => setTimeout(settled, 0));
        },
      });
    });
  /** @type {string[][]} */
  const shown = [];
  const store = createNotesStore('s1', (notes) => shown.push(notes.map((note) => note.text)));
  /** @param {string} what — a change's action, or list, or history */
  const request = (what) => {
    const found = asked.find((one) => one.what === what);
    assert.ok(found !== undefined, `no request to ${what}`);
    asked.splice(asked.indexOf(found), 1);
    return found;
  };
  return { store, shown, request };
}

/** @param {string} text @param {string} at */
const note = (text, at) => ({ id: at, text, at, shown: /** @type {const} */ ('inline') });

// A reply older than the latest change — the list asked for before it, an earlier change's — does not take the change
// away from what shows: the latest change's own reply brings the notes as the server keeps them
test('notesStore_Should_KeepLatestChangeShown_When_OlderReplyComesAfterIt', async () => {
  const { store, shown, request } = storeAnsweredByHand();

  store.add('# Plan', 'inline');
  await request('list').answer([]);
  store.add('# Ideas', 'inline');
  await request('add').answer([note('# Plan', '1')]);
  await request('add').answer([note('# Ideas', '2'), note('# Plan', '1')]);

  assert.deepEqual(shown, [['# Plan'], ['# Ideas', '# Plan'], ['# Ideas', '# Plan']]);
});

// A note written the way asked — set apart from the start — is the one whose id comes back; a step undone shows at
// once, the server told the change that undoes it; the history is read as the server keeps it
test('notesStore_Should_AddNoteTheWayAsked_UndoStepAtOnce_AndReadHistory', async () => {
  const { store, shown, request } = storeAnsweredByHand();
  const plan = note('# Plan', '1');
  const removed = { id: 's1', at: '2026-10-27T10:00:00.000Z', action: 'remove', before: plan };
  await request('list').answer([]);

  const id = store.add('# Ideas', 'panel');
  const added = request('add').change?.note;
  store.undo({ ...removed, action: 'remove', after: undefined });
  const undone = request('put').change;
  const reading = store.history();
  await request('history').answer([removed, { id: 's0', action: 'fly' }]);

  assert.deepEqual(
    { added, undone, shown: shown.slice(1), history: (await reading)?.map((step) => step.id) },
    {
      added: { id, text: '# Ideas', at: isoOf(added), shown: 'panel' },
      undone: { action: 'put', note: plan },
      shown: [['# Ideas'], ['# Ideas', '# Plan']],
      history: ['s1'],
    },
  );
});

/** The time a note sent was stamped with, whatever it is. @param {unknown} sent */
function isoOf(sent) {
  return sent !== null && typeof sent === 'object' && 'at' in sent && typeof sent.at === 'string' ? sent.at : 'no time';
}
