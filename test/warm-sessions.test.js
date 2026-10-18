import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWarmSessions } from '../public/view/warm-sessions.js';
import { createSessionRelay } from '../public/view/session-relay.js';

// The sessions put out of sight are kept as shown, the latest so many: past them, the one put away longest ago is let
// go of; one taken out to show is no longer kept, and one dropped is let go of
test('warmSessions_Should_KeepLatestSessionsPutAway_LettingGoOfTheOldest', () => {
  /** @type {string[]} */
  const letGo = [];
  const warm = createWarmSessions({ most: 2, budget: 100, weigh: () => 1, letGo: (/** @type {string} */ part) => void letGo.push(part) });

  warm.keep('s1', 'feed 1');
  warm.keep('s2', 'feed 2');
  warm.keep('s1', 'feed 1 again');
  warm.keep('s3', 'feed 3');
  const taken = warm.takeOut('s3');
  const kept = ['s1', 's2', 's3'].filter((id) => warm.has(id));
  warm.drop('s1');

  assert.deepEqual({ taken, kept, letGo, keptAfterDrop: ['s1', 's2', 's3'].filter((id) => warm.has(id)) }, { taken: 'feed 3', kept: ['s1'], letGo: ['feed 2', 'feed 1 again'], keptAfterDrop: [] });
});

// As many sessions are kept as their weight allows — a feed grows while out of sight, and is weighed as it is then —
// the one put away last kept whatever it weighs, the ones put away longest ago let go of first
test('warmSessions_Should_KeepAsManyAsTheirWeightAllows_TheLastPutAwayWhateverItWeighs', () => {
  /** @type {string[]} */
  const letGo = [];
  /** @typedef {{ name: string, weight: number }} Part */
  const warm = createWarmSessions({ most: 10, budget: 10, weigh: (/** @type {Part} */ part) => part.weight, letGo: (/** @type {Part} */ part) => void letGo.push(part.name) });
  const kept = () => ['s1', 's2', 's3', 's4', 's5', 's6'].filter((id) => warm.has(id));
  const s2 = { name: 's2', weight: 3 };

  warm.keep('s1', { name: 's1', weight: 4 });
  warm.keep('s2', s2);
  warm.keep('s3', { name: 's3', weight: 2 });
  const light = kept();
  s2.weight = 5;
  warm.keep('s4', { name: 's4', weight: 1 });
  const grown = kept();
  warm.keep('s5', { name: 's5', weight: 1 });
  warm.keep('s6', { name: 's6', weight: 30 });

  assert.deepEqual({ light, grown, heavy: kept(), letGo }, { light: ['s1', 's2', 's3'], grown: ['s2', 's3', 's4'], heavy: ['s6'], letGo: ['s1', 's2', 's3', 's4', 's5'] });
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
