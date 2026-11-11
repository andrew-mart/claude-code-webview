import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { agyPanes, agyPidsListed, agyProcessOf, agyStartedId, agyStartedSessions, createAgyCheck, createAgyProcesses } from '../server/agy-live.js';

/** The lines of agy's log a process starts with: its language server, its folder. */
const started = [
  'I1110 08:19:17.602285      82 server.go:2312] Starting language server process with pid 51520',
  'I1110 08:19:17.693459       1 server.go:313] Creating CLI server backend: product=antigravity workspaceDirs=[D:\\dev\\shop] appDataDir=C:\\Users\\ann\\.gemini\\antigravity-cli languageServer=true',
];
const first = 'c2da1db1-1271-4baa-aac2-0f4026b2453a';
const other = '9342f993-b892-4839-845d-ce2d261b092e';

// An agy process as its log tells it: the pid of the language server it started — alive while agy runs — its folder, the
// conversation it streams now — the one it went over to last; none before the first message — whether it is a
// program's run, agy -p, and whether it ended, its language server shut down; a log that is not agy's, nothing
test('agyProcessOf_Should_TellServerFolderConversationRunByProgramAndEnd', () => {
  const working = [...started, `I1110 08:19:26.581836    1126 server.go:1233] Created conversation ${first} (backend=BACKEND_TYPE_UNSPECIFIED)`, `I1110 08:19:26.582836    1126 conversation_manager.go:1107] Streaming conversation ${first}`, `I1110 08:40:02.100000    1126 conversation_manager.go:1107] Streaming conversation ${other}`];
  const printed = [...started, 'I1110 12:33:11.862145       1 printmode.go:208] Print mode: starting (promptLength=43, model="gemini-4-argon-medium", conversationID="")', `I1110 12:33:13.710999       1 session.go:201] Print mode: conversation=${first}, sending message`];
  const closed = [...working, 'I1110 10:01:18.179095    5424 server.go:4046] Language server shutting down', 'E1110 10:01:18.180000     162 file_watcher.go:194] skipping empty or temp file: '];

  assert.deepEqual(
    [agyProcessOf(working.join('\n')), agyProcessOf(printed.join('\n')), agyProcessOf(started.join('\n')), agyProcessOf(closed.join('\n')), agyProcessOf('some other log')],
    [
      { serverPid: 51520, folder: 'D:\\dev\\shop', conversation: other, print: false, ended: false },
      { serverPid: 51520, folder: 'D:\\dev\\shop', conversation: first, print: true, ended: false },
      { serverPid: 51520, folder: 'D:\\dev\\shop', conversation: undefined, print: false, ended: false },
      { serverPid: 51520, folder: 'D:\\dev\\shop', conversation: other, print: false, ended: true },
      undefined,
    ],
  );
});

// agy's processes alive now, from its logs, each started when its log is named: a run whose log tells it ended, or whose
// language server is no longer agy's — gone, or its pid given to another program — has ended; a conversation agy holds
// open — in a terminal, or a program's run writing it — is open, and so is a run before its first message, by the id it
// goes by until agy makes its conversation; any other not
test('agyProcesses_Should_TellRunsAliveFromTheirLogs_AndConversationsTheyHoldOpen', async () => {
  const home = tempDir('ccw-agy-');
  await mkdir(join(home, 'log'));
  const log = (/** @type {number} */ pid, /** @type {string} */ folder, /** @type {readonly string[]} */ more) =>
    [`I1110 08:19:17.602285 82 server.go:2312] Starting language server process with pid ${pid}`, `I1110 08:19:17.693459 1 server.go:313] Creating CLI server backend: product=antigravity workspaceDirs=[${folder}] appDataDir=x`, ...more].join('\n');
  await writeFile(join(home, 'log', 'cli-20261110_081917.log'), log(101, 'D:\\dev\\shop', [`I1110 08:19:26 1126 conversation_manager.go:1107] Streaming conversation ${first}`]));
  await writeFile(join(home, 'log', 'cli-20261110_090000.log'), log(102, 'D:\\dev\\shop', [`I1110 09:00:26 1126 conversation_manager.go:1107] Streaming conversation ${other}`]));
  await writeFile(join(home, 'log', 'cli-20261110_123311.log'), log(103, 'D:\\dev\\notes', ['I1110 12:33:11 1 printmode.go:208] Print mode: starting (promptLength=43)', `I1110 12:33:13 1 session.go:201] Print mode: conversation=${other}, sending message`]));
  await writeFile(join(home, 'log', 'acp-server-20261110_122009-29492.log'), log(104, 'D:\\dev\\shop', []));
  await writeFile(join(home, 'log', 'cli-20261110_100000.log'), log(105, 'D:\\dev\\maps', ['I1110 10:00:26 1126 conversation_manager.go:1107] Streaming conversation 0569c158-6d1a-409e-9a15-6e92eaf4c4a1', 'I1110 10:01:18 5424 server.go:4046] Language server shutting down']));
  await writeFile(join(home, 'log', 'cli-20261110_110000.log'), log(106, 'D:\\dev\\blank', []));
  const processes = createAgyProcesses({ home, agyOnes: (pids) => new Set(pids.filter((pid) => pid !== 102)) });
  const fresh = agyStartedId({ serverPid: 106, folder: 'D:\\dev\\blank', conversation: undefined, print: false, ended: false, startedAt: new Date(2026, 10, 10, 11, 0, 0).getTime() });

  const open = await processes.open();

  assert.deepEqual(
    { open: open.map(({ serverPid, conversation, print, startedAt }) => ({ serverPid, conversation, print, startedAt })).sort((a, b) => a.serverPid - b.serverPid), held: [await processes.holds(first), await processes.holds(other), await processes.holds('0569c158-6d1a-409e-9a15-6e92eaf4c4a1'), await processes.holds(fresh)] },
    {
      open: [
        { serverPid: 101, conversation: first, print: false, startedAt: new Date(2026, 10, 10, 8, 19, 17).getTime() },
        { serverPid: 103, conversation: other, print: true, startedAt: new Date(2026, 10, 10, 12, 33, 11).getTime() },
        { serverPid: 106, conversation: undefined, print: false, startedAt: new Date(2026, 10, 10, 11, 0, 0).getTime() },
      ],
      held: [true, true, false, true],
    },
  );
});

// A run before its first message goes by an id of its own, a session's id in shape, made from the run — the same for
// it each time, another for another run — marked apart from those of agy's conversations
test('agyStartedId_Should_NameRunBeforeItsFirstMessage_TheSameEachTime', () => {
  /** @param {number} serverPid @param {number} startedAt @returns {import('../server/agy-live.js').AgyRun} */
  const run = (serverPid, startedAt) => ({ serverPid, folder: 'D:\\dev\\blank', conversation: undefined, print: false, ended: false, startedAt });
  const id = agyStartedId(run(48964, 1794380353000));

  assert.deepEqual(
    { shaped: /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), again: agyStartedId(run(48964, 1794380353000)) === id, otherStart: agyStartedId(run(48964, 1794380999000)) === id, otherPid: agyStartedId(run(48965, 1794380353000)) === id },
    { shaped: true, again: true, otherStart: false, otherPid: false },
  );
});

// The runs before their first message, as sessions just started: each in its folder, since it started; a program's run,
// a run with its conversation, a run with no folder, is none
test('agyStartedSessions_Should_ListRunsBeforeTheirFirstMessage', () => {
  /** @type {import('../server/agy-live.js').AgyRun} */
  const fresh = { serverPid: 1, folder: 'D:\\dev\\blank', conversation: undefined, print: false, ended: false, startedAt: 1000 };
  /** @type {import('../server/agy-live.js').AgyRun[]} */
  const runs = [
    fresh,
    { serverPid: 2, folder: 'D:\\dev\\blank', conversation: undefined, print: true, ended: false, startedAt: 2000 },
    { serverPid: 3, folder: 'D:\\dev\\shop', conversation: first, print: false, ended: false, startedAt: 3000 },
    { serverPid: 4, folder: undefined, conversation: undefined, print: false, ended: false, startedAt: 4000 },
  ];

  assert.deepEqual(agyStartedSessions(runs), [{ id: agyStartedId(fresh), cwd: 'D:\\dev\\blank', startedAt: 1000, agent: 'agy' }]);
});

/**
 * A herdr pane of the agent and in the folder given.
 * @param {string} paneId
 * @param {string | undefined} agent
 * @param {string} cwd
 * @returns {import('../server/herdr.js').Pane}
 */
const paneOf = (paneId, agent, cwd) => ({ paneId, workspaceId: 'w2', tabId: `${paneId}t`, cwd, agent, status: 'idle', title: undefined, size: undefined, activity: undefined, terminal: undefined });

// The conversation an agy pane runs: of the agy runs in its folder — however the folder's slashes lean — the one there;
// before its first message, the run's own id, a session just started. Panes of a folder with more runs than one cannot
// be told apart and are left out — a terminal, not a feed — as are a program's runs, in no terminal
test('agyPanes_Should_FindEachPanesConversationByItsFolder_OrItsRunBeforeTheFirstMessage', () => {
  const panes = [paneOf('w2:p1', 'agy', 'D:/dev/shop'), paneOf('w2:p2', 'agy', 'D:\\dev\\notes'), paneOf('w2:p3', 'agy', 'D:\\dev\\maps'), paneOf('w2:p4', 'agy', 'D:\\dev\\maps'), paneOf('w2:p5', 'claude', 'D:\\dev\\shop'), paneOf('w2:p6', 'agy', 'D:\\dev\\blank')];
  /** @type {import('../server/agy-live.js').AgyRun} */
  const fresh = { serverPid: 6, folder: 'D:\\dev\\blank', conversation: undefined, print: false, ended: false, startedAt: 6000 };
  /** @type {import('../server/agy-live.js').AgyRun[]} */
  const runs = [
    { serverPid: 1, folder: 'D:\\dev\\shop', conversation: first, print: false, ended: false, startedAt: 1000 },
    { serverPid: 2, folder: 'D:\\dev\\notes', conversation: other, print: false, ended: false, startedAt: 2000 },
    { serverPid: 3, folder: 'D:\\dev\\notes', conversation: '0569c158-6d1a-409e-9a15-6e92eaf4c4a1', print: true, ended: false, startedAt: 3000 },
    { serverPid: 4, folder: 'D:\\dev\\maps', conversation: '063a54cf-fffa-497a-9d93-f02f6fbdbb2a', print: false, ended: false, startedAt: 4000 },
    { serverPid: 5, folder: 'D:\\dev\\maps', conversation: '09d2663b-ce2e-4904-81ee-623767ea9579', print: false, ended: false, startedAt: 5000 },
    fresh,
  ];

  const found = agyPanes(panes, runs);

  assert.deepEqual(
    { conversations: [...found.conversations], started: [...found.started] },
    {
      conversations: [
        ['w2:p1', first],
        ['w2:p2', other],
      ],
      started: [['w2:p6', agyStartedId(fresh)]],
    },
  );
});

// Windows' list of processes (tasklist /FO CSV /NH) tells agy's by their programs: agy itself, and a language server of
// its own should it run one apart; any other program is none of agy's, though its name holds agy's
test('agyPidsListed_Should_TellAgysProcessesInWindowsList', () => {
  const csv = ['"System Idle Process","0","Services","0","8 K"', '"agy.exe","53216","Console","1","212,004 K"', '"language_server_windows_x64.exe","53300","Console","1","98,120 K"', '"node.exe","7048","Console","1","61,300 K"', '"notagy.exe","7100","Console","1","1,000 K"', '"Agy.EXE","7200","Console","1","1,000 K"'].join('\r\n');

  assert.deepEqual(agyPidsListed(csv), [53216, 53300, 7200]);
});

// Which pids are agy's, told at once from what the system last said of each: a pid it has not told of yet is none of
// agy's until its answer comes — asked in the background, slow on Windows; one gone is agy's no longer; one told of long
// ago is asked of again, its old answer standing meanwhile
test('agyCheck_Should_TellAgysFromSystemsLastAnswer_AskingItInTheBackground', async () => {
  const time = { now: 0 };
  const living = new Set([11, 12, 13]);
  const system = { agys: [11, 12] };
  /** @type {number[][]} */
  const asked = [];
  const check = createAgyCheck({
    alive: (pid) => living.has(pid),
    agyAmong: async (pids) => {
      asked.push([...pids]);
      return system.agys.filter((pid) => pids.includes(pid));
    },
    now: () => time.now,
  });
  const answered = () => new Promise((resolve) => setImmediate(resolve));
  const told = () => [...check([11, 12, 13, 14])];

  const before = told();
  await answered();
  const after = told();
  living.delete(12);
  const gone = told();
  system.agys = [13];
  time.now = 60_000;
  const meanwhile = told();
  await answered();
  const again = told();

  assert.deepEqual({ told: [before, after, gone, meanwhile, again], asked }, { told: [[], [11, 12], [11], [11], [13]], asked: [[11, 12, 13], [11, 13]] });
});
