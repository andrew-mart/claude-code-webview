// @ts-check
// The computer's processes, the busiest with one of its resources first — the page's meters of how busy it is, pressed:
// the processors, as each one's share of all of them since the look before, as the computer's own share is told
// (system-usage.js); the memory each holds; the graphics card's engines, each one's load — asked for only when they are
// what the list is by, as they take a while to read.
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord } from '../public/model/narrow.js';

/**
 * @typedef {{ pid: number, name: string, cpuMs: number, memory: number }} ProcessSample — cpuMs: the processors' time
 *   it has had so far; memory: bytes
 * @typedef {{ at: number, processes: readonly ProcessSample[] }} Look — at: ms, of the look's clock
 * @typedef {{ pid: number, name: string, cpu: number, memory: number, gpu: number | undefined }} ProcessUse — cpu:
 *   percent of all the processors' time since the look before; gpu: percent of the card's engines, when the list is by
 *   them
 * @typedef {'cpu' | 'memory' | 'gpu'} Resource
 */

/** The first look is followed by another this long after: a share of the processors needs time gone by. */
const firstLookGapMs = 1000;
/** A look before this long ago is too old to tell shares by: two looks are taken anew. */
const staleLookMs = 30_000;
/** How many processes are told, the busiest. */
const listedAtMost = 12;

/**
 * @param {{ sample: () => Promise<Look>, gpu: () => Promise<ReadonlyMap<number, number>>, cores: number, wait: (ms: number) => Promise<void> }} parts
 *   — sample: the processes now; gpu: the card's engines' load, percent, by process; cores: the processors there are
 * @returns {{ read: (by: Resource) => Promise<ProcessUse[]> }}
 */
export function createProcesses({ sample, gpu, cores, wait }) {
  /** @type {Look | undefined} */
  let before;
  return {
    async read(by) {
      // the card read meanwhile: it takes as long as the looks do
      const reading = by === 'gpu' ? gpu() : undefined;
      let earlier = before;
      let now = await sample();
      if (earlier === undefined || now.at <= earlier.at || now.at - earlier.at > staleLookMs) {
        earlier = now;
        await wait(firstLookGapMs);
        now = await sample();
      }
      before = now;
      const loads = await reading;
      const uses = sharesSince(earlier, now, cores).map((use) => ({ ...use, gpu: loads === undefined ? undefined : engineLoad(loads, use.pid) }));
      return uses.toSorted((one, other) => valueOf(other, by) - valueOf(one, by) || other.memory - one.memory).slice(0, listedAtMost);
    },
  };
}

/**
 * Each process of the look now, with its share of all the processors' time since the look before — none for one not
 * there then, as its time so far may have been had before it.
 * @param {Look} earlier
 * @param {Look} now
 * @param {number} cores
 * @returns {Omit<ProcessUse, 'gpu'>[]}
 */
function sharesSince(earlier, now, cores) {
  const spentBefore = new Map(earlier.processes.map((one) => [`${one.pid}:${one.name}`, one.cpuMs]));
  const available = (now.at - earlier.at) * cores;
  return now.processes.map(({ pid, name, cpuMs, memory }) => {
    const then = spentBefore.get(`${pid}:${name}`);
    const share = then === undefined || available <= 0 ? 0 : Math.round((Math.max(0, cpuMs - then) / available) * 100);
    return { pid, name, cpu: Math.min(100, share), memory };
  });
}

/**
 * A process's load of the card's engines: one the card tells nothing of uses none of them.
 * @param {ReadonlyMap<number, number>} loads
 * @param {number} pid
 */
function engineLoad(loads, pid) {
  const load = loads.get(pid);
  return load === undefined ? 0 : load;
}

/**
 * @param {ProcessUse} use
 * @param {Resource} by
 */
function valueOf(use, by) {
  if (by === 'cpu') return use.cpu;
  if (by === 'memory') return use.memory;
  // the list by the card's engines has every process's load; another tells none, and sorts by none
  return use.gpu === undefined ? 0 : use.gpu;
}

/**
 * Windows' processes as PowerShell tells Win32_Process in JSON — the processors' time in 100 ns, kernel and user apart,
 * the memory in use in bytes; the idle process is none. One process alone comes as no list; what is not that, nothing.
 * @param {string} json
 * @returns {ProcessSample[]}
 */
export function parseWin32Processes(json) {
  const items = listOf(json);
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const { ProcessId: pid, Name: name, KernelModeTime: kernel, UserModeTime: user, WorkingSetSize: memory } = item;
    if (typeof pid !== 'number' || pid === 0 || typeof name !== 'string' || typeof kernel !== 'number' || typeof user !== 'number' || typeof memory !== 'number') return [];
    return [{ pid, name, cpuMs: Math.round((kernel + user) / 10_000), memory }];
  });
}

/**
 * The graphics card's engines' load by process, percent, as Windows' counters tell it in JSON: an instance per engine,
 * named after its process — pid_3976_luid_…_engtype_3d — summed by process, at most all of them.
 * @param {string} json
 * @returns {Map<number, number>}
 */
export function parseGpuEngines(json) {
  /** @type {Map<number, number>} */
  const loads = new Map();
  for (const item of listOf(json)) {
    const named = isRecord(item) && typeof item.InstanceName === 'string' ? /^pid_(\d+)_/.exec(item.InstanceName)?.[1] : undefined;
    const value = isRecord(item) ? item.CookedValue : undefined;
    if (named === undefined || typeof value !== 'number') continue;
    const pid = Number(named);
    const before = loads.get(pid);
    loads.set(pid, before === undefined ? value : before + value);
  }
  return new Map([...loads].map(([pid, load]) => [pid, Math.min(100, Math.round(load))]));
}

/**
 * PowerShell's JSON of a list: one item alone comes as no list; what is no JSON, nothing.
 * @param {string} json
 * @returns {unknown[]}
 */
function listOf(json) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * A Linux process as /proc/<pid>/stat tells it: its name in brackets — brackets and spaces may be in it, so the fields
 * are counted from the last closing one — the processors' time in clock ticks, user and system apart (fields 14 and
 * 15), the memory in pages (field 24); a line that is not that, nothing.
 * @param {string} line
 * @param {{ tickMs: number, pageBytes: number }} units — how long a clock tick is, how big a page
 * @returns {ProcessSample | undefined}
 */
export function parseProcStat(line, { tickMs, pageBytes }) {
  const opened = line.indexOf(' (');
  const closed = line.lastIndexOf(') ');
  if (opened < 0 || closed < opened) return undefined;
  const pid = Number(line.slice(0, opened));
  // the fields after the name, from the third — the state — on
  const fields = line.slice(closed + 2).split(' ');
  const [user, system, pages] = [fields[11], fields[12], fields[21]].map(Number);
  if (!Number.isSafeInteger(pid) || user === undefined || system === undefined || pages === undefined || ![user, system, pages].every(Number.isFinite)) return undefined;
  return { pid, name: line.slice(opened + 2, closed), cpuMs: (user + system) * tickMs, memory: pages * pageBytes };
}

/**
 * Each process's load of the card's processors, percent, as nvidia-smi pmon tells it: a line each — gpu, pid, type, sm
 * … — under heads of its own, "-" for none.
 * @param {string} text
 * @returns {Map<number, number>}
 */
export function parseNvidiaPmon(text) {
  /** @type {Map<number, number>} */
  const loads = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const [, pid, , sm] = line.trim().split(/\s+/);
    if (pid === undefined || sm === undefined || !/^\d+$/.test(pid)) continue;
    loads.set(Number(pid), sm === '-' ? 0 : Number(sm));
  }
  return loads;
}

/** PowerShell and nvidia-smi are waited for this long at most. */
const askTimeoutMs = 15_000;
/** Linux counts a process's time in ticks of 10 ms (USER_HZ 100) and its memory in pages of 4 KB. */
const linuxUnits = { tickMs: 10, pageBytes: 4096 };
/**
 * Windows' processes, as Win32_Process tells them — a thousand in under a second, where their performance counters take
 * five — the look's time halfway through, first on a line of its own.
 */
const windowsProcessesScript = [
  '$start = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
  '$list = Get-CimInstance Win32_Process -Property ProcessId,Name,KernelModeTime,UserModeTime,WorkingSetSize | Select-Object ProcessId,Name,KernelModeTime,UserModeTime,WorkingSetSize | ConvertTo-Json -Compress',
  '$end = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
  '[math]::Round(($start + $end) / 2)',
  '$list',
].join('; ');
/** The card's engines' load by process, as Windows' counters tell it: some two seconds. */
const windowsGpuScript = String.raw`(Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples | Select-Object InstanceName, CookedValue | ConvertTo-Json -Compress`;

/** This computer's processes: Windows' through PowerShell, Linux's from /proc; elsewhere none. */
export function createLocalProcesses() {
  const platform = process.platform;
  return createProcesses({
    sample: platform === 'win32' ? sampleWindows : platform === 'linux' ? sampleLinux : async () => ({ at: Date.now(), processes: [] }),
    gpu: platform === 'win32' ? windowsGpu : createNvidiaLoads(),
    cores: cpus().length,
    wait: (ms) => delay(ms),
  });
}

/** @returns {Promise<Look>} */
async function sampleWindows() {
  const told = await powershell(windowsProcessesScript);
  const lineEnd = told.indexOf('\n');
  const at = Number(told.slice(0, lineEnd));
  if (lineEnd < 0 || !Number.isFinite(at)) throw new Error(`PowerShell told no processes: ${told.slice(0, 200)}`);
  return { at, processes: parseWin32Processes(told.slice(lineEnd + 1)) };
}

/** @returns {Promise<Map<number, number>>} */
async function windowsGpu() {
  return parseGpuEngines(await powershell(windowsGpuScript));
}

/**
 * @param {string} script
 * @returns {Promise<string>}
 */
function powershell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: askTimeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error === null) resolve(stdout);
      else reject(new Error('PowerShell failed to tell the processes', { cause: error }));
    });
  });
}

/** @returns {Promise<Look>} */
async function sampleLinux() {
  const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
  // a process may end between the list and its file: it is left out
  const lines = await Promise.all(pids.map((pid) => readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')));
  return { at: Date.now(), processes: lines.flatMap((line) => parseProcStat(line, linuxUnits) ?? []) };
}

/**
 * The card's processors' load by process as nvidia-smi pmon tells it; a computer without it is not asked again.
 * @returns {() => Promise<Map<number, number>>}
 */
function createNvidiaLoads() {
  let missing = false;
  return () =>
    new Promise((resolve) => {
      if (missing) {
        resolve(new Map());
        return;
      }
      execFile('nvidia-smi', ['pmon', '-c', '1', '-s', 'u'], { timeout: askTimeoutMs, windowsHide: true }, (error, stdout) => {
        if (error !== null && 'code' in error && error.code === 'ENOENT') missing = true;
        resolve(error === null ? parseNvidiaPmon(stdout) : new Map());
      });
    });
}
