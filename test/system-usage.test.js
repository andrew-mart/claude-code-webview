import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSystemUsage, parseNvidiaSmi } from '../server/system-usage.js';

// nvidia-smi's lines, a card on each: the busiest card's load, the memory of all of them together; what is no such line
// tells no card
test('parseNvidiaSmi_Should_TellBusiestCardsLoad_AndAllCardsMemory_OrNoCard', () => {
  assert.deepEqual(
    [parseNvidiaSmi('5, 1598, 8192\n40, 2000, 8192\n'), parseNvidiaSmi(''), parseNvidiaSmi('NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver.')],
    [{ load: 40, memoryUsed: 3598, memoryTotal: 16384 }, undefined, undefined],
  );
});

// How busy the computer is: its processors since the last look — the share of their time spent working — its memory
// taken, and its card as told; a look too soon after the last, no time gone by, tells the processors as then
test('systemUsage_Should_TellProcessorsSinceLastLook_MemoryTaken_AndCard', async () => {
  const times = [
    { busy: 100, total: 1000 },
    { busy: 400, total: 2000 },
    { busy: 400, total: 2000 },
  ];
  let looked = 0;
  const usage = createSystemUsage({
    cpuTimes: () => times[Math.min(looked++, times.length - 1)] ?? { busy: 0, total: 0 },
    memory: () => ({ total: 32_000, free: 8_000 }),
    gpu: async () => ({ load: 12, memoryUsed: 1600, memoryTotal: 8192 }),
  });

  const first = await usage.read();
  const tooSoon = await usage.read();

  assert.deepEqual([first, tooSoon.cpu], [{ cpu: 30, memory: { used: 24_000, total: 32_000 }, gpu: { load: 12, memoryUsed: 1600, memoryTotal: 8192 } }, 30]);
});
