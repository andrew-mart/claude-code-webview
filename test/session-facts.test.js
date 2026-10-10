import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextGauge, modelName } from '../public/model/session-facts.js';

test('modelName_Should_NameClaudeModelsAsPeopleCallThemAndLeaveOthersAsTheyAre', () => {
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelName('claude-opus-5'), 'Opus 5');
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelName('claude-opus-4-6[1m]'), 'Opus 4.6');
  assert.equal(modelName('gpt-6-astra'), 'gpt-6-astra');
});

test('contextGauge_Should_TakeWindowOfModelAsClaudeCodeGivesIt', () => {
  /** @param {string} model @param {{ tokens?: number, extended?: boolean }} [options] */
  const window = (model, options = {}) => contextGauge({ model, tokens: 50_000, extended: false, ...options }).window;

  // a native 1M window
  assert.equal(window('claude-opus-5-5'), 1_000_000);
  assert.equal(window('claude-fable-5-1'), 1_000_000);
  assert.equal(window('claude-sonnet-5'), 1_000_000);
  assert.equal(window('claude-haiku-5-5'), 1_000_000);
  assert.equal(window('claude-opus-4-7'), 1_000_000);
  // 1M only through the [1m] variant: named so in the session's costs, or given away by a context past 200K
  assert.equal(window('claude-opus-4-6'), 200_000);
  assert.equal(window('claude-opus-4-6', { extended: true }), 1_000_000);
  assert.equal(window('claude-sonnet-4-6', { tokens: 300_000 }), 1_000_000);
  assert.equal(window('claude-haiku-4-5-20251001'), 200_000);
  // a model Claude Code does not know: the transcript does not tell its window
  assert.equal(window('gpt-6-astra'), undefined);
});

test('contextGauge_Should_TellHowMuchIsLeftAndWarnAsWindowFills', () => {
  /** @param {number} tokens */
  const gauge = (tokens) => contextGauge({ model: 'claude-opus-5-5', tokens, extended: false });
  /** @param {number} tokens */
  const level = (tokens) => {
    const filled = gauge(tokens);
    return filled.window === undefined ? undefined : filled.level;
  };

  assert.deepEqual(gauge(412_000), { tokens: 412_000, window: 1_000_000, left: 588_000, share: 0.412, level: 'calm' });
  assert.equal(level(750_000), 'warm');
  assert.equal(level(930_000), 'hot');
});
