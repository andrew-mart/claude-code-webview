import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
// a box opened with a draft in it is fitted to it on the next frame
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, sessionStorage: window.sessionStorage, HTMLElement: window.HTMLElement, File: window.File, requestAnimationFrame: (/** @type {() => void} */ callback) => setTimeout(callback, 0) });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

// the tab's storage keeps a question being answered: one test's is not another's
beforeEach(() => window.sessionStorage.clear());

// A side question's answer belongs to its session, not to the box on the screen: switching to another session and back
// — even while Claude is still answering — shows it again, until it is closed
test('composer_Should_KeepSideAnswer_AcrossSwitchingSessions', async () => {
  /** @type {(value: Response) => void} */
  let answer = () => undefined;
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path) => {
      if (path === '/api/btw') return new Promise((resolve) => (answer = resolve));
      return new Response(JSON.stringify({ state: 'live', status: 'idle', pane: 'w1:p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const asides = createAsideStore();
  const open = async () => {
    const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides, onSent: () => undefined });
    window.document.body.append(composer.element);
    await settle();
    return composer;
  };
  /** @param {Awaited<ReturnType<typeof open>>} composer */
  const shown = (composer) => {
    const aside = composer.element.querySelector('.side-answer');
    return aside instanceof window.HTMLElement && !aside.hidden ? aside.querySelector('.side-answer-text')?.textContent : undefined;
  };

  const first = await open();
  const box = first.element.querySelector('.composer-input');
  const form = first.element.querySelector('.composer-box');
  assert.ok(box instanceof window.HTMLTextAreaElement && form instanceof window.HTMLElement);
  box.value = '/btw where is the config?';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await settle();
  first.dispose();
  first.element.remove();
  const whileAnswering = await open();
  const answering = shown(whileAnswering);
  answer(new Response(JSON.stringify({ ok: true, answer: 'In src/config.ts.' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await settle();
  const answered = shown(whileAnswering);
  whileAnswering.dispose();
  whileAnswering.element.remove();
  const later = await open();
  const again = shown(later);
  later.element.querySelector('.side-answer-close')?.dispatchEvent(new window.Event('click'));
  later.dispose();
  later.element.remove();
  const afterClosing = await open();
  const closed = shown(afterClosing);
  afterClosing.dispose();

  assert.deepEqual({ answering, answered, again, closed }, { answering: 'Answering…', answered: 'In src/config.ts.', again: 'In src/config.ts.', closed: undefined });
});

// An answer outlives a reload of the page's tab, and so does a question still being answered — the page reloaded asks
// for its answer again; a closed one is gone
test('asideStore_Should_KeepAnswersAndQuestionsBeingAnsweredAcrossReload', () => {
  const before = createAsideStore();
  before.set('s1', { question: 'Where is the config?', answer: 'In src/config.ts.' });
  before.set('s2', { question: 'And the tests?', answer: undefined });
  before.set('s3', { question: 'Closed?', answer: 'Yes.' });
  before.set('s3', undefined);

  const after = createAsideStore();

  assert.deepEqual(['s1', 's2', 's3'].map((id) => after.get(id)), [{ question: 'Where is the config?', answer: 'In src/config.ts.' }, { question: 'And the tests?', answer: undefined }, undefined]);
});

// A side question leaves the box as it is asked — it shows over the box while Claude answers — and comes back into the
// box when it was not answered, to be asked again
test('composer_Should_ClearBoxWhenAskingAside_AndPutQuestionBackWhenNotAnswered', async () => {
  /** @param {unknown} reply */
  const ask = async (reply) => {
    /** @type {(value: Response) => void} */
    let answer = () => undefined;
    Object.assign(globalThis, {
      matchMedia: () => ({ matches: false }),
      fetch: async (/** @type {string} */ path) => {
        if (path === '/api/btw') return new Promise((resolve) => (answer = resolve));
        return new Response(JSON.stringify({ state: 'live', status: 'idle', pane: 'w1:p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined });
    window.document.body.append(composer.element);
    await settle();
    const box = composer.element.querySelector('.composer-input');
    const form = composer.element.querySelector('.composer-box');
    assert.ok(box instanceof window.HTMLTextAreaElement && form instanceof window.HTMLElement);
    box.value = '/btw where is the config?';
    box.dispatchEvent(new window.Event('input', { bubbles: true }));
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    await settle();
    const whileAnswering = box.value;
    answer(new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await settle();
    const after = box.value;
    composer.dispose();
    composer.element.remove();
    return { whileAnswering, after };
  };

  assert.deepEqual(
    { answered: await ask({ ok: true, answer: 'In src/config.ts.' }), refused: await ask({ ok: false, error: 'no-answer' }) },
    { answered: { whileAnswering: '', after: '' }, refused: { whileAnswering: '', after: '/btw where is the config?' } },
  );
});

// Codex has its side questions as well: in its session "/btw …" is asked as one, not sent as a message
test('composer_Should_AskBtwAsSideQuestion_InCodexSession', async () => {
  /** @type {string[]} */
  const posted = [];
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path, /** @type {RequestInit | undefined} */ init) => {
      if (init?.method === 'POST') posted.push(`${path} ${String(init.body)}`);
      const reply = path === '/api/send' ? { ok: true, pane: 'w4:p1' } : path === '/api/btw' ? { ok: true, answer: 'In config.toml.' } : { state: 'live', status: 'idle', pane: 'w4:p1' };
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const composer = createComposer(sessionId, { agent: 'codex', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined });
  window.document.body.append(composer.element);
  await settle();
  const box = composer.element.querySelector('.composer-input');
  const form = composer.element.querySelector('.composer-box');
  assert.ok(box instanceof window.HTMLTextAreaElement && form instanceof window.HTMLElement);
  box.value = '/btw where is the config?';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await settle();
  composer.dispose();
  composer.element.remove();

  assert.deepEqual(posted, [`/api/btw {"session":"${sessionId}","question":"where is the config?"}`]);
});

// What Codex queued to send next shows above the box, sent once its turn is over; nothing queued, nothing shown
test('composer_Should_ShowWhatCodexQueued_AboveTheBox', async () => {
  /** @param {readonly string[]} queued */
  const open = async (queued) => {
    Object.assign(globalThis, {
      matchMedia: () => ({ matches: false }),
      fetch: async () => new Response(JSON.stringify({ state: 'live', status: 'busy', pane: 'w4:p1', queued }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    const composer = createComposer(sessionId, { agent: 'codex', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined });
    window.document.body.append(composer.element);
    await settle();
    const list = composer.element.querySelector('.composer-queued');
    const shown = { items: list instanceof window.HTMLElement && !list.hidden ? [...list.querySelectorAll('li')].map((item) => item.textContent) : [], note: list?.querySelector('.composer-queued-note')?.textContent };
    composer.dispose();
    composer.element.remove();
    return shown;
  };

  assert.deepEqual([await open(['Then update the docs.', 'And the changelog.']), (await open([])).items], [{ items: ['Then update the docs.', 'And the changelog.'], note: 'Codex sends these next, once its turn is over.' }, []]);
});

/**
 * The page's box for the session, over a viewer whose /api/btw replies come as given — none: the request lost — each
 * request's body recorded.
 * @param {import('../public/view/aside-store.js').AsideStore} asides
 * @param {readonly (unknown | undefined)[]} replies — in order of the requests
 */
async function boxOverViewer(asides, replies) {
  /** @type {unknown[]} */
  const asked = [];
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path, /** @type {RequestInit | undefined} */ init) => {
      if (path === '/api/btw') {
        asked.push(JSON.parse(String(init?.body)));
        const reply = replies[asked.length - 1];
        if (reply === undefined) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ state: 'live', status: 'idle', pane: 'w1:p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides, onSent: () => undefined });
  window.document.body.append(composer.element);
  const shown = () => {
    const aside = composer.element.querySelector('.side-answer');
    return aside instanceof window.HTMLElement && !aside.hidden ? aside.querySelector('.side-answer-text')?.textContent : undefined;
  };
  return { composer, asked, shown };
}

/** The page's promises settled — setImmediate, not the timers the test has taken over. */
const flush = async () => {
  for (let turn = 0; turn < 5; turn++) await new Promise((done) => setImmediate(done));
};

// The request for a side question lost — the viewer restarted, the network dropped — while Claude answers in the
// terminal: the question stays over the box, and its answer is asked for again a little later, not the question anew
test('composer_Should_AskForAnswerAgain_When_RequestIsLost', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { composer, asked, shown } = await boxOverViewer(createAsideStore(), [undefined, undefined, { ok: true, answer: 'In src/config.ts.' }]);
  t.mock.timers.tick(0);
  await flush();
  const box = composer.element.querySelector('.composer-input');
  const form = composer.element.querySelector('.composer-box');
  assert.ok(box instanceof window.HTMLTextAreaElement && form instanceof window.HTMLElement);
  box.value = '/btw where is the config?';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await flush();
  const lost = [shown(), box.value];
  for (let wait = 0; wait < 2; wait++) {
    t.mock.timers.tick(3000);
    await flush();
  }
  const answered = shown();
  composer.dispose();
  composer.element.remove();

  assert.deepEqual(
    { lost, answered, asked },
    {
      lost: ['Answering…', ''],
      answered: 'In src/config.ts.',
      asked: [{ session: sessionId, question: 'where is the config?' }, { session: sessionId, question: 'where is the config?', resume: true }, { session: sessionId, question: 'where is the config?', resume: true }],
    },
  );
});

// The page reloaded while Claude answered a side question: the box shows the question being answered and asks for its
// answer again
test('composer_Should_AskForAnswerAgain_OfQuestionBeingAnsweredBeforeReload', async () => {
  createAsideStore().set(sessionId, { question: 'where are the tests?', answer: undefined });

  const { composer, asked, shown } = await boxOverViewer(createAsideStore(), [{ ok: true, answer: 'In test/.' }]);
  await settle();
  const answered = shown();
  composer.dispose();
  composer.element.remove();

  assert.deepEqual({ answered, asked }, { answered: 'In test/.', asked: [{ session: sessionId, question: 'where are the tests?', resume: true }] });
});
