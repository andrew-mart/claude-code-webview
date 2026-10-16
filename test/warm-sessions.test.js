import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWarmSessions } from '../public/view/warm-sessions.js';
import { createSessionRelay } from '../public/view/session-relay.js';

// The sessions put out of sight are kept as shown, the latest so many: past them, the one put away longest ago is let
// go of; one taken out to show is no longer kept, and one dropped is let go of
test('warmSessions_Should_KeepLatestSessionsPutAway_LettingGoOfTheOldest', () => {
  /** @type {string[]} */
  const letGo = [];
  const warm = createWarmSessions({ limit: 2, letGo: (/** @type {string} */ part) => void letGo.push(part) });

  warm.keep('s1', 'feed 1');
  warm.keep('s2', 'feed 2');
  warm.keep('s1', 'feed 1 again');
  warm.keep('s3', 'feed 3');
  const taken = warm.takeOut('s3');
  const kept = ['s1', 's2', 's3'].filter((id) => warm.has(id));
  warm.drop('s1');

  assert.deepEqual({ taken, kept, letGo, keptAfterDrop: ['s1', 's2', 's3'].filter((id) => warm.has(id)) }, { taken: 'feed 3', kept: ['s1'], letGo: ['feed 2', 'feed 1 again'], keptAfterDrop: [] });
});

// What a session's feed tells goes to what shows it now; what shows it next is told all of it again first — its details,
// its status, its prompts since the feed last started over — then what comes; nothing goes to what showed it before
test('sessionRelay_Should_TellWhatShowsSessionNow_AllOfItAgainFirst', () => {
  const relay = createSessionRelay();
  /** @type {string[]} */
  const heard = [];
  /** @param {string} name */
  const target = (name) => ({
    onMeta: (/** @type {Record<string, unknown>} */ meta) => void heard.push(`${name} meta ${JSON.stringify(meta)}`),
    onStatus: (/** @type {string} */ status) => void heard.push(`${name} status ${status}`),
    onPrompt: (/** @type {{ id: string }} */ prompt) => void heard.push(`${name} prompt ${prompt.id}`),
    onReset: () => void heard.push(`${name} reset`),
  });
  const prompt = (/** @type {string} */ id) => ({ id, kind: /** @type {const} */ ('prompt'), label: id, at: '' });

  relay.attach(target('first'));
  relay.listener.onPrompt(prompt('p1'));
  relay.listener.onReset();
  relay.listener.onPrompt(prompt('p2'));
  relay.listener.onMeta({ title: 'Shop' });
  relay.listener.onStatus('idle');
  relay.attach(target('second'));
  relay.listener.onPrompt(prompt('p3'));

  assert.deepEqual(heard, [
    'first reset',
    'first meta {}',
    'first status connecting',
    'first prompt p1',
    'first reset',
    'first prompt p2',
    'first meta {"title":"Shop"}',
    'first status idle',
    'second reset',
    'second meta {"title":"Shop"}',
    'second status idle',
    'second prompt p2',
    'second prompt p3',
  ]);
});
