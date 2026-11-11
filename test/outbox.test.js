import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox, waitingSessions } from '../public/view/outbox.js';

/** @typedef {import('../public/model/composer.js').SendOutcome} SendOutcome */

/** A browser's storage as one origin has it: shared by its tabs. */
function storageOf() {
  /** @type {Map<string, string>} */
  const kept = new Map();
  return {
    kept,
    /** @param {string} key */
    getItem: (key) => kept.get(key) ?? null,
    /** @param {string} key @param {string} value */
    setItem: (key, value) => void kept.set(key, value),
    /** @param {string} key */
    removeItem: (key) => void kept.delete(key),
  };
}

/** The browser's locks as its tabs share them: one holder of a name at a time, the others after it in turn. */
function locksOf() {
  /** @type {Map<string, Promise<unknown>>} */
  const held = new Map();
  return {
    /**
     * @template T
     * @param {string} name @param {() => Promise<T>} work
     * @returns {Promise<T>}
     */
    request(name, work) {
      const done = (held.get(name) ?? Promise.resolve()).then(work);
      held.set(name, done.catch(() => undefined));
      return done;
    },
  };
}

/**
 * A tab's outbox of the session s1 over this storage and these locks, the viewer answering each prompt as told — none
 * while it is out of reach; the prompts it took recorded.
 * @param {ReturnType<typeof storageOf>} storage
 * @param {ReturnType<typeof locksOf>} locks
 * @param {{ answer: (text: string) => SendOutcome | undefined }} viewer
 * @param {string[]} sent
 */
function outboxOf(storage, locks, viewer, sent) {
  /** @type {string[][]} */
  const shown = [];
  const outbox = createOutbox('s1', {
    storage,
    locks,
    send: async ({ id, text }) => {
      await new Promise((done) => setTimeout(done, 1));
      const outcome = viewer.answer(text);
      if (outcome?.ok === true) sent.push(`${id} ${text}`);
      return outcome;
    },
    onChange: (waiting) => shown.push(waiting.map((one) => one.text)),
  });
  return { outbox, shown };
}

/** @type {SendOutcome} */
const ok = { ok: true, pane: 'w1:p1' };

// Prompts sent while the viewer is out of reach wait — kept by the browser, so a page opened anew has them — and go in
// the order sent once it is back, each gone only once the viewer says it went: none is lost while it does not answer
test('outbox_Should_KeepPromptsSentOutOfReach_AndSendThemInOrderOnceBack', async () => {
  const storage = storageOf();
  /** @type {{ answer: (text: string) => SendOutcome | undefined }} */
  const viewer = { answer: () => undefined };
  /** @type {string[]} */
  const sent = [];
  const { outbox } = outboxOf(storage, locksOf(), viewer, sent);

  outbox.add('p1', 'Run the tests');
  outbox.add('p2', 'Then fix what fails');
  await outbox.flush();
  const stillOut = outbox.waiting().map((one) => one.text);
  const reopened = outboxOf(storage, locksOf(), viewer, sent).outbox.waiting().map((one) => one.text);
  viewer.answer = () => ok;
  await outbox.flush();

  assert.deepEqual({ stillOut, reopened, sent, left: outbox.waiting() }, { stillOut: ['Run the tests', 'Then fix what fails'], reopened: ['Run the tests', 'Then fix what fails'], sent: ['p1 Run the tests', 'p2 Then fix what fails'], left: [] });
});

// A prompt the viewer refuses — the session ended meanwhile — stays, saying why, and the ones after it wait behind it;
// one given back to the box is gone from the outbox, its words handed back, and the refused one sent again goes
test('outbox_Should_StopAtPromptRefused_TellingWhy_ToSendAgainOrGiveBack', async () => {
  /** @type {SendOutcome | undefined} */
  let reply = { ok: false, error: 'offline' };
  /** @type {string[]} */
  const sent = [];
  const { outbox } = outboxOf(storageOf(), locksOf(), { answer: () => reply }, sent);
  outbox.add('p1', 'Run the tests');
  outbox.add('p2', 'Then fix what fails');

  await outbox.flush();
  const refused = outbox.waiting().map((one) => [one.text, one.refused ?? '']);
  reply = ok;
  await outbox.flush();
  const stays = outbox.waiting().length;
  const givenBack = outbox.takeBack('p2');
  await outbox.sendAgain('p1');

  assert.deepEqual(
    { refused, stays, sent, givenBack, left: outbox.waiting() },
    {
      refused: [
        ['Run the tests', 'The session is no longer running.'],
        ['Then fix what fails', ''],
      ],
      stays: 2,
      sent: ['p1 Run the tests'],
      givenBack: 'Then fix what fails',
      left: [],
    },
  );
});

// Two tabs of the page sending what the browser keeps at once go one after the other: each prompt goes once
test('outbox_Should_SendEachPromptOnce_When_TwoTabsSendAtOnce', async () => {
  const storage = storageOf();
  const locks = locksOf();
  /** @type {string[]} */
  const sent = [];
  const viewer = { answer: () => ok };
  const first = outboxOf(storage, locks, viewer, sent).outbox;
  const second = outboxOf(storage, locks, viewer, sent).outbox;
  first.add('p1', 'Run the tests');
  first.add('p2', 'Then fix what fails');

  await Promise.all([first.flush(), second.flush()]);

  assert.deepEqual(sent, ['p1 Run the tests', 'p2 Then fix what fails']);
});

// The browser keeping nothing — a private window, storage refused — the prompts wait in the page itself
test('outbox_Should_KeepPromptsInPage_When_BrowserKeepsNothing', () => {
  const refusing = {
    getItem: () => {
      throw new Error('storage refused');
    },
    setItem: () => {
      throw new Error('storage refused');
    },
    removeItem: () => {
      throw new Error('storage refused');
    },
  };
  const outbox = createOutbox('s1', { storage: refusing, locks: locksOf(), send: async () => undefined, onChange: () => undefined });

  outbox.add('p1', 'Run the tests');

  assert.deepEqual(outbox.waiting().map((one) => one.text), ['Run the tests']);
});

// The sessions with prompts waiting, as the browser keeps them — for the page to send those of sessions not open too,
// once the viewer is back; other things the browser keeps are not taken for them
test('waitingSessions_Should_TellSessionsWithPromptsWaiting', () => {
  const kept = new Map([
    ['viewer.outbox.s1', '[]'],
    ['viewer.draft.s1', 'Half a prompt'],
    ['viewer.outbox.s2', '[]'],
    ['viewer.theme', 'dark'],
  ]);
  const keys = [...kept.keys()];

  assert.deepEqual(waitingSessions({ length: keys.length, key: (at) => keys[at] ?? null }), ['s1', 's2']);
});
