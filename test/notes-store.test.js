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

  store.add('# Plan', 'inline', '');
  await request('list').answer([]);
  store.add('# Ideas', 'inline', '');
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

  const id = store.add('# Ideas', 'panel', '');
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

// A note is written under a name, or named and renamed as it is edited: the name goes to the server with the change; a
// note written with its name left blank goes without one
test('notesStore_Should_SendNoteName_WithNoteWrittenOrEdited', async () => {
  const { store, request } = storeAnsweredByHand();
  await request('list').answer([]);

  const id = store.add('# Ideas', 'panel', 'Backlog');
  const added = request('add').change?.note;
  store.edit(id, '# Ideas\n- more', 'Ideas backlog');
  const edited = request('edit').change;
  store.add('# Plan', 'panel', ' ');
  const unnamed = request('add').change?.note;

  assert.deepEqual(
    { added, edited, unnamed: unnamed !== null && typeof unnamed === 'object' && 'name' in unnamed },
    { added: { id, text: '# Ideas', at: isoOf(added), shown: 'panel', name: 'Backlog' }, edited: { action: 'edit', id, text: '# Ideas\n- more', name: 'Ideas backlog' }, unnamed: false },
  );
});

// A note moved shows in its new place at once — before the one it is let go before, or last — the server told the move
test('notesStore_Should_ShowNoteMovedAtOnce_AndTellServer', async () => {
  const { store, shown, request } = storeAnsweredByHand();
  await request('list').answer([note('# Plan', '3'), note('# Ideas', '2'), note('# Deploy', '1')]);

  store.move('3', '1');
  const before = request('move').change;
  store.move('2', undefined);
  const last = request('move').change;

  assert.deepEqual(
    { shown: shown.slice(-2), before, last },
    { shown: [['# Ideas', '# Plan', '# Deploy'], ['# Plan', '# Deploy', '# Ideas']], before: { action: 'move', id: '3', before: '1' }, last: { action: 'move', id: '2' } },
  );
});
