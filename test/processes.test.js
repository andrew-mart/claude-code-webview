import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProcesses, parseGpuEngines, parseNvidiaPmon, parseProcStat, parseWin32Processes } from '../server/processes.js';

const mb = 1024 * 1024;

/**
 * The computer's processes as the test tells them, a look at a time: the time each has had the processors so far, its
 * memory; the clock moving a second between looks, and on as the test says.
 * @param {{ pid: number, name: string, cpuMs: number, memory: number }[][]} looks
 */
function computer(looks) {
  let now = 0;
  let looked = 0;
  return {
    sample: async () => {
      const processes = looks[Math.min(looked, looks.length - 1)];
      looked++;
      if (processes === undefined) throw new Error('no look');
      return { at: now, processes };
    },
    wait: async (/** @type {number} */ ms) => {
      now += ms;
    },
    /** @param {number} ms */
    pass(ms) {
      now += ms;
    },
    looks: () => looked,
  };
}

// The processes busiest with the processors first: each one's share of all of them since the look before — the first
// time asked, two looks a second apart — and the memory each holds beside it
test('processes_Should_ListTheBusiestFirst_ByTheirShareOfAllProcessorsSinceTheLookBefore', async () => {
  const machine = computer([
    [
      { pid: 41, name: 'node', cpuMs: 1000, memory: 100 * mb },
      { pid: 77, name: 'chrome', cpuMs: 5000, memory: 300 * mb },
      { pid: 90, name: 'sshd', cpuMs: 20, memory: 8 * mb },
    ],
    [
      { pid: 41, name: 'node', cpuMs: 3000, memory: 110 * mb },
      { pid: 77, name: 'chrome', cpuMs: 5400, memory: 300 * mb },
      { pid: 90, name: 'sshd', cpuMs: 20, memory: 8 * mb },
    ],
    [
      { pid: 41, name: 'node', cpuMs: 3400, memory: 110 * mb },
      { pid: 77, name: 'chrome', cpuMs: 9400, memory: 320 * mb },
      { pid: 90, name: 'sshd', cpuMs: 20, memory: 8 * mb },
    ],
  ]);
  const processes = createProcesses({ sample: machine.sample, gpu: async () => new Map(), cores: 4, wait: machine.wait });

  const first = await processes.read('cpu');
  machine.pass(1000);
  const next = await processes.read('cpu');

  assert.deepEqual(
    { first, next, looks: machine.looks() },
    {
      first: [
        { pid: 41, name: 'node', cpu: 50, memory: 110 * mb, gpu: undefined },
        { pid: 77, name: 'chrome', cpu: 10, memory: 300 * mb, gpu: undefined },
        { pid: 90, name: 'sshd', cpu: 0, memory: 8 * mb, gpu: undefined },
      ],
      next: [
        { pid: 77, name: 'chrome', cpu: 100, memory: 320 * mb, gpu: undefined },
        { pid: 41, name: 'node', cpu: 10, memory: 110 * mb, gpu: undefined },
        { pid: 90, name: 'sshd', cpu: 0, memory: 8 * mb, gpu: undefined },
      ],
      looks: 3,
    },
  );
});

// By the memory each holds, the most first; by the graphics card's engines, each one's load — asked of the card only
// for that list, as it takes a while — one the card tells nothing of using none. A look before half a minute ago is too
// old to tell shares by: two looks are taken anew
test('processes_Should_ListByMemoryOrByTheCardsLoad_AskingTheCardOnlyForThat', async () => {
  const look = [
    { pid: 41, name: 'node', cpuMs: 1000, memory: 100 * mb },
    { pid: 77, name: 'chrome', cpuMs: 5000, memory: 300 * mb },
    { pid: 90, name: 'blender', cpuMs: 20, memory: 50 * mb },
  ];
  const machine = computer([look]);
  let cardAsked = 0;
  const processes = createProcesses({
    sample: machine.sample,
    gpu: async () => {
      cardAsked++;
      return new Map([
        [90, 64],
        [77, 3],
      ]);
    },
    cores: 4,
    wait: machine.wait,
  });

  const byMemory = await processes.read('memory');
  const cardAskedForMemory = cardAsked;
  machine.pass(40_000);
  const byCard = await processes.read('gpu');

  assert.deepEqual(
    { byMemory: byMemory.map(({ name, memory }) => [name, memory / mb]), cardAskedForMemory, byCard: byCard.map(({ name, gpu }) => [name, gpu]), looks: machine.looks() },
    {
      byMemory: [
        ['chrome', 300],
        ['node', 100],
        ['blender', 50],
      ],
      cardAskedForMemory: 0,
      byCard: [
        ['blender', 64],
        ['chrome', 3],
        ['node', 0],
      ],
      looks: 4,
    },
  );
});

// Windows tells its processes through Win32_Process, as PowerShell's JSON: the processors' time in 100 ns, kernel and
// user apart; the memory in use, bytes. The idle process is no process; one process alone comes as no list
test('parseWin32Processes_Should_ReadEachProcessesTimeAndMemory_LeavingTheIdleOneOut', () => {
  const many = JSON.stringify([
    { ProcessId: 0, Name: 'System Idle Process', KernelModeTime: 999_990_000, UserModeTime: 0, WorkingSetSize: 8192 },
    { ProcessId: 4120, Name: 'node.exe', KernelModeTime: 12_500_000, UserModeTime: 37_500_000, WorkingSetSize: 104_857_600 },
    { ProcessId: 5300, Name: 'Code.exe', KernelModeTime: 0, UserModeTime: 20_000, WorkingSetSize: 52_428_800 },
  ]);
  const one = JSON.stringify({ ProcessId: 4120, Name: 'node.exe', KernelModeTime: 10_000, UserModeTime: 0, WorkingSetSize: 4096 });

  assert.deepEqual(
    [parseWin32Processes(many), parseWin32Processes(one), parseWin32Processes('not json')],
    [
      [
        { pid: 4120, name: 'node.exe', cpuMs: 5000, memory: 104_857_600 },
        { pid: 5300, name: 'Code.exe', cpuMs: 2, memory: 52_428_800 },
      ],
      [{ pid: 4120, name: 'node.exe', cpuMs: 1, memory: 4096 }],
      [],
    ],
  );
});

// The graphics card's engines' load each process puts on them, as Windows' counters tell it: an instance per engine —
// its process in its name — summed by process, at most all of them
test('parseGpuEngines_Should_SumEachProcessesEnginesLoad', () => {
  const samples = JSON.stringify([
    { InstanceName: 'pid_3976_luid_0x00000000_0x00029f21_phys_0_eng_0_engtype_3d', CookedValue: 9.6 },
    { InstanceName: 'pid_3976_luid_0x00000000_0x00029f21_phys_0_eng_5_engtype_videodecode', CookedValue: 1.2 },
    { InstanceName: 'pid_2248_luid_0x00000000_0x00029f21_phys_0_eng_0_engtype_3d', CookedValue: 0.04 },
    { InstanceName: 'pid_900_luid_0x00000000_0x00029f21_phys_0_eng_0_engtype_3d', CookedValue: 70 },
    { InstanceName: 'pid_900_luid_0x00000000_0x00029f21_phys_0_eng_1_engtype_compute_0', CookedValue: 60 },
  ]);

  assert.deepEqual([...parseGpuEngines(samples)], [
    [3976, 11],
    [2248, 0],
    [900, 100],
  ]);
});

// Linux tells a process in /proc/<pid>/stat: its name in brackets — brackets and spaces may be in it — the processors'
// time in clock ticks, user and system apart, the memory in pages; a line that is not that, nothing
test('parseProcStat_Should_ReadTheProcessesTimeAndMemory_WhateverItsName', () => {
  const stat = (/** @type {string} */ head) => `${head} S 1 1234 1234 0 -1 4194560 3000 0 0 0 250 50 0 0 20 0 11 0 12345 1100000000 25600 18446744073709551615 1 1`;

  assert.deepEqual(
    [parseProcStat(stat('1234 (node)'), { tickMs: 10, pageBytes: 4096 }), parseProcStat(stat('77 (tmux: server (main))'), { tickMs: 10, pageBytes: 4096 }), parseProcStat('gone', { tickMs: 10, pageBytes: 4096 })],
    [{ pid: 1234, name: 'node', cpuMs: 3000, memory: 104_857_600 }, { pid: 77, name: 'tmux: server (main)', cpuMs: 3000, memory: 104_857_600 }, undefined],
  );
});

// nvidia-smi pmon tells each process's load of the card's processors — "-" for none — under lines of its own heads
test('parseNvidiaPmon_Should_ReadEachProcessesLoadOfTheCard', () => {
  const told = [
    '# gpu         pid   type     sm    mem    enc    dec    command',
    '# Idx           #    C/G      %      %      %      %    name',
    '    0       1234     C     45     10      -      -    python',
    '    0       5678     G      -      -      -      -    Xorg',
  ].join('\n');

  assert.deepEqual([...parseNvidiaPmon(told)], [
    [1234, 45],
    [5678, 0],
  ]);
});
