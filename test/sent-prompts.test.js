import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSentPrompts } from '../server/sent-prompts.js';

/** @typedef {import('../public/model/composer.js').SendOutcome} SendOutcome */

// A prompt sent again under the id it went by — its reply lost on the way, or two tabs sending what one waited with —
// is typed once: the reply it had comes back, and one asked for while it is being sent waits for it. One refused goes
// again — nothing was typed; another id, or another session's, is another prompt; the oldest are let go past the limit
test('sentPrompts_Should_SendPromptOnceUnderItsId_AndAgainOnceRefused', async () => {
  const sent = createSentPrompts(2);
  /** @type {string[]} */
  const typed = [];
  /** @param {string} text @param {SendOutcome} outcome */
  const sending = (text, outcome) => async () => {
    typed.push(text);
    await new Promise((done) => setTimeout(done, 5));
    return outcome;
  };
  /** @type {SendOutcome} */
  const ok = { ok: true, pane: 'w1:p1' };
  /** @type {SendOutcome} */
  const refused = { ok: false, error: 'offline' };

  const [first, meanwhile] = await Promise.all([sent.once('s1', 'p1', sending('Go on', ok)), sent.once('s1', 'p1', sending('Go on', ok))]);
  const again = await sent.once('s1', 'p1', sending('Go on', ok));
  const notTyped = await sent.once('s1', 'p2', sending('Check it', refused));
  const typedOnceBack = await sent.once('s1', 'p2', sending('Check it', ok));
  const elsewhere = await sent.once('s2', 'p1', sending('Elsewhere', ok));
  await sent.once('s1', 'p3', sending('Third', ok));
  const letGo = await sent.once('s1', 'p1', sending('Go on', ok));

  assert.deepEqual(
    { replies: [first, meanwhile, again, notTyped, typedOnceBack, elsewhere, letGo], typed },
    {
      replies: [ok, ok, ok, refused, ok, ok, ok],
      typed: ['Go on', 'Check it', 'Check it', 'Elsewhere', 'Third', 'Go on'],
    },
  );
});
