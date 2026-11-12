// @ts-check
// Starting the viewer server in this process.
import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createVsCode, desktopVsCode } from '../server/vscode.js';
import { bringForward } from '../server/window-front.js';
import { startServer } from '../server/app.js';
import { createBookmarkFile } from '../server/bookmarks.js';
import { createLaterFile } from '../server/later.js';
import { createDeskFiles } from '../server/desk-files.js';
import { moveToDesks } from '../server/desk-migration.js';
import { createDesks } from '../server/desks.js';
import { createPinsFile } from '../server/pins.js';
import { createSeenFile } from '../server/seen.js';
import { createDiagnosticsLog } from '../server/diagnostics.js';
import { createKeptFile } from '../server/kept.js';
import { createUploads } from '../server/uploads.js';
import { createComposer } from '../server/composer.js';
import { latestRecords, readSessionRecords, startedSessions } from '../server/registry.js';
import { createHerdrRunner, herdrTurnedOff, paneIoOf, pasteAsTyped, readSavedHerdr, resolveHerdr, saveHerdr } from '../server/herdr.js';
import { createHerdrSocket, socketRunner } from '../server/herdr-socket.js';
import { createHerdrView } from '../server/herdr-view.js';
import { createCodexThreads, lockHeld } from '../server/codex-live.js';
import { createHiddenPanes } from '../server/hidden-panes.js';
import { createHiddenWorkspaces } from '../server/hidden-workspaces.js';
import { createAgyConversations } from '../server/agy-conversations.js';
import { agyProcessesAmong, agyStartedSessions, createAgyCheck, createAgyProcesses, processAlive } from '../server/agy-live.js';
import { createWorkspaceIcons } from '../server/workspace-icons.js';
import { createSessionIndex } from '../server/sessions.js';
import { createTerminals } from '../server/terminal.js';
import { readUsage, readChatGptUsage, readAgyUsage } from '../server/usage.js';
import { createLocalSystemUsage } from '../server/system-usage.js';
import { createLocalProcesses } from '../server/processes.js';
import { createClaudeModels } from '../server/claude-model.js';
import { readSessionStatus } from '../server/session-status.js';
import { openInEditor } from '../server/editor.js';
import { createSystemEditor, shellOpen, startApart, windowsHandlers } from '../server/system-editor.js';
import { openInFileManager } from '../server/file-manager.js';
import { claudeCommands, codexCommands } from '../server/commands.js';
import { endProcess } from '../server/end-process.js';

/**
 * The viewer's settings and log folder: the remembered herdr (herdr.json), bookmarks of all sessions (bookmarks.json),
 * the herdr workspaces of sessions seen running (workspaces.json), the herdr panes hidden from the page's list until
 * their agents change state (hidden-panes.json), images attached to prompts (uploads/), the background
 * server log (server.log), the account's usage a statusline drops in (rate-limits.json, see the README), what
 * Antigravity CLI gave its status line last, which that drops in (agy-statusline.json, likewise).
 */
export const stateDir = join(homedir(), '.claude-code-webview');

/**
 * The Claude Code folder: CLAUDE_CONFIG_DIR if it was relocated, otherwise ~/.claude.
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function claudeDir(env) {
  return env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
}

/**
 * Claude Code's own state, its reading of the account's usage among it: .claude.json beside the relocated folder,
 * otherwise in the home folder.
 * @param {Readonly<Record<string, string | undefined>>} env
 */
function claudeStateFile(env) {
  return join(env.CLAUDE_CONFIG_DIR ?? homedir(), '.claude.json');
}

/** @type {Readonly<Record<import('../server/herdr.js').HerdrTarget['source'], string>>} */
const herdrSources = {
  env: 'from this herdr pane (remembered for launches outside herdr)',
  saved: 'remembered from a previous launch inside herdr',
  path: 'from PATH',
};

/** herdr is asked what it shows at most this often: each call starts a process. */
const herdrRefreshMs = 3_000;
/** Claude Code started from the page is watched this long for the question whether to trust its folder: 30 s. */
const claudeTrustPace = { looks: 60, stepMs: 500 };
/** A session restarted from the page: its Claude Code is waited for this long to end before it is started again. */
const claudeEndPace = { waitMs: 10_000, stepMs: 100 };

/**
 * @param {{ port: number, about: import('../server/app.js').About, palette: import('../public/model/palettes.js').Palette, publicAddresses: readonly import('../server/app.js').PublicAddress[], herdr: 'on' | 'off', claudeCommand: string, claudeGptCommand?: string | undefined, chatgptUsageFile?: string | undefined, codexCommand: string, agyCommand: string, restartEnv: readonly import('../server/herdr-view.js').ShellVariable[], editor: import('../server/editor.js').EditorCommand | undefined, vscode: string | undefined }} options
 * @returns {Promise<{ url: string, close: () => void }>}
 */
export async function serve({ port, about, palette, publicAddresses, herdr, claudeCommand, claudeGptCommand, chatgptUsageFile, codexCommand, agyCommand, restartEnv, editor, vscode }) {
  await mkdir(stateDir, { recursive: true });
  const { run, via, note } = await herdrToUse(herdr);
  const claude = claudeDir(process.env);
  const readRecords = () => readSessionRecords(join(claude, 'sessions'));
  const usageFiles = { claudeState: claudeStateFile(process.env), rateLimits: join(stateDir, 'rate-limits.json') };
  // agy's usage: what it gave its status line last, if that drops it here
  const agyStatusLine = join(stateDir, 'agy-statusline.json');
  // Codex's sessions beside Claude Code's: none while it has never run here
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  // Antigravity CLI's conversations as well: none while it has never run here
  const agyHome = join(homedir(), '.gemini', 'antigravity-cli');
  // a new tab starts agy where it has run: its home is there
  const agyHere = await stat(agyHome).then((info) => info.isDirectory(), () => false);
  const agyProcesses = createAgyProcesses({ home: agyHome, agyOnes: createAgyCheck({ alive: processAlive, agyAmong: agyProcessesAmong, now: Date.now }) });
  // the sessions open with no transcript yet: Claude Code's, and agy's runs before their first message
  const started = async () => [...startedSessions(await readRecords()), ...agyStartedSessions(await agyProcesses.open())];
  const index = createSessionIndex(join(claude, 'projects'), { summaryBudgetMs: 1500, missRetryMs: 2000, codexRoot: join(codexHome, 'sessions'), agy: createAgyConversations(agyHome), started });
  const codexThreads = createCodexThreads({ home: codexHome, summaryOf: index.summaryOf, held: lockHeld });
  const icons = createWorkspaceIcons({ file: join(stateDir, 'workspace-icons.json'), random: Math.random });
  const herdrView = createHerdrView({ herdr: run, readRecords, codexThreads: codexThreads.open, icons, hidden: createHiddenPanes(join(stateDir, 'hidden-panes.json')), hiddenWorkspaces: createHiddenWorkspaces(join(stateDir, 'hidden-workspaces.json')), file: join(stateDir, 'workspaces.json'), refreshMs: herdrRefreshMs, trust: claudeTrustPace, claudeCommand, claudeGptCommand, claudeModelOf: createClaudeModels(index.find), codexCommand, agyCommand: agyHere ? agyCommand : undefined, agyRuns: agyProcesses.open, listed: () => index.list(), restart: { env: restartEnv, shell: process.platform === 'win32' ? 'powershell' : 'posix', endProcess: (pid) => endProcess(pid, claudeEndPace) } });
  // the notes and files pinned for a piece of work, on desks in the folders worked in (desks.js): a session's is its herdr
  // workspace's, else the one of the folder it started in — Codex's, the folder it runs in
  const deskFiles = createDeskFiles();
  const desks = createDesks({
    registry: join(stateDir, 'desks.json'),
    files: deskFiles,
    limit: 200,
    place: async (id) => {
      const session = (await index.list()).find((one) => one.id === id);
      if (session === undefined) return undefined;
      const { sessions: workspaces } = await herdrView.workspacesOf([session]);
      return { startedIn: session.agent === 'codex' ? session.cwd : session.startedIn, workspace: workspaces[id] };
    },
  });
  await moveNotesOntoDesks({ index, herdrView, files: deskFiles, desks });
  const composer = createComposer({ readRecords, herdr: run, codexPlace: herdrView.codexPlace, agyPlace: herdrView.agyPlace });
  // A terminal on the page: through herdr's socket a screen is read in a millisecond or two, so it is read every 40 ms
  // while typing; through the herdr program every call starts a process, a tenth of a second.
  const terminals = createTerminals({ io: paneIoOf(run), quickMs: via === 'socket' ? 40 : 200, slowMs: via === 'socket' ? 500 : 1000, quickForMs: 4000 });
  // VS Code in the browser, its token kept beside the viewer's other files — named by the port: another viewer on this
  // computer has a VS Code of its own
  // with no editor given, on Windows a file opens with the program set for its kind (system-editor.js); elsewhere the
  // viewer has no editor
  const systemEditor = process.platform === 'win32' ? createSystemEditor({ handlersOf: windowsHandlers, run: startApart, openAsShell: shellOpen, bringForward }) : undefined;
  // the computer's own VS Code, for a browser on it — on Windows, opened by the viewer in the background, it is brought
  // before the browser
  const desktopProgram = vscode === undefined ? undefined : desktopVsCode(vscode, process.platform);
  const vscodeServer =
    vscode === undefined
      ? undefined
      : createVsCode({
          command: [vscode],
          desktop: desktopProgram === undefined ? undefined : [desktopProgram],
          tokenFile: join(stateDir, `vscode-token-${port}`),
          bringForward: () => {
            if (process.platform === 'win32' && desktopProgram !== undefined) bringForward(basename(desktopProgram).replace(/\.exe$/i, ''));
          },
        });
  const server = await startServer({ index, host: '127.0.0.1', port, pollMs: 400, changesEveryMs: 2000, composer, bookmarks: createBookmarkFile(join(stateDir, 'bookmarks.json')), later: createLaterFile(join(stateDir, 'later.json')), desks, pins: createPinsFile(join(stateDir, 'pins.json')), seen: createSeenFile(join(stateDir, 'seen.json'), { limit: 500 }), kept: createKeptFile(join(stateDir, 'kept.json'), { limit: 200 }), diagnostics: createDiagnosticsLog(join(stateDir, 'diagnostics.jsonl'), { maxBytes: 5_000_000 }), uploads: createUploads(join(stateDir, 'uploads')), about, palette, publicAddresses, herdrView, terminals, usage: () => readUsage(usageFiles), system: createLocalSystemUsage(), processes: createLocalProcesses(), chatgptUsage: () => readChatGptUsage(chatgptUsageFile, Date.now()), agyUsage: () => readAgyUsage(agyStatusLine, Date.now()), sessionStatus: (id) => readSessionStatus(join(stateDir, 'session-status'), id), isRunning: async (id) => latestRecords(await readRecords()).has(id) || (await codexThreads.holds(id)) || (await agyProcesses.holds(id)), editor: editor !== undefined ? (path, line) => openInEditor(editor, path, line) : systemEditor, fileManager: openInFileManager, commands: ({ agent, cwd }) => (agent === 'codex' ? codexCommands({ home: codexHome }) : agent === 'agy' ? Promise.resolve([]) : claudeCommands({ config: claude, cwd })), vscode: vscodeServer, codexInUse: async () => (await codexThreads.open()).length > 0 });
  const url = `http://127.0.0.1:${server.port}/`;
  console.log(`Claude Code Webview ${about.version}: ${url}`);
  for (const publicAddress of publicAddresses) console.log(`Also answers at ${publicAddress.origin}/ — keep it behind a login such as Cloudflare Access`);
  console.log(`Sessions: ${join(claude, 'projects')}`);
  console.log(note);
  if (vscode !== undefined) console.log(`VS Code: ${vscode} — in the browser at ${url}vscode/ once a page asks for it.`);
  return {
    url,
    close: () => {
      vscodeServer?.close();
      server.close();
    },
  };
}

/**
 * The notes and files pinned per project folder before desks, moved onto desks once (desk-migration.js), with every
 * session's folder read first. The move going wrong is told and the viewer starts: the old files are as they were, and
 * the move runs again on the next start.
 * @param {{ index: ReturnType<typeof createSessionIndex>, herdrView: ReturnType<typeof createHerdrView>, files: import('../server/desk-files.js').DeskFiles, desks: import('../server/desks.js').Desks }} parts
 */
async function moveNotesOntoDesks({ index, herdrView, files, desks }) {
  const report = join(stateDir, 'desks-moved.json');
  if (await stat(report).then(() => true, () => false)) return;
  console.log('Moving the notes and pinned files onto desks, in the folders worked in…');
  try {
    const sessions = await everySummary(index);
    const { sessions: workspaces } = await herdrView.workspacesOf(sessions);
    const orphans = join(stateDir, 'orphaned');
    const moved = await moveToDesks({ notes: join(stateDir, 'notes.json'), history: join(stateDir, 'notes-history.json'), pins: join(stateDir, 'pins.json'), report, orphans, files, desks, sessions, workspaceOf: (id) => workspaces[id] });
    if (!moved.moved) return;
    const count = (/** @type {'notes' | 'pins'} */ what) => moved.desks.reduce((sum, desk) => sum + desk[what], 0);
    const kept = moved.desks.filter((desk) => desk.orphaned).length;
    console.log(`Moved onto ${moved.desks.length} desks: ${count('notes')} notes, ${count('pins')} files pinned${kept === 0 ? '' : ` — ${kept} of them kept in ${orphans}, their folders no longer known`}; what went where: ${report}`);
  } catch (error) {
    console.error('The notes and pinned files were not moved onto desks; the old files are as they were, and the move runs again on the next start', error);
  }
}

/**
 * The sessions, every one's summary made: the list makes them a while at a time, so it is asked again until no more come.
 * @param {ReturnType<typeof createSessionIndex>} index
 */
async function everySummary(index) {
  for (let unknown = Number.POSITIVE_INFINITY; ; ) {
    const sessions = await index.list();
    const left = sessions.filter((session) => session.startedIn === undefined && session.cwd === undefined).length;
    if (left === 0 || left >= unknown) return sessions;
    unknown = left;
  }
}

/**
 * The herdr the viewer types prompts and finds workspaces through, and the log line about it.
 * @param {'on' | 'off'} use
 * @returns {Promise<{ run: import('../server/composer.js').RunHerdr, via: 'socket' | 'program', note: string }>} — via: how
 *   herdr is reached: its socket, when known — a millisecond or two a call — or its program, a tenth of a second
 */
async function herdrToUse(use) {
  if (use === 'off') return { run: herdrTurnedOff, via: 'program', note: 'herdr: off (--no-herdr) — the viewer only reads sessions.' };
  const herdrFile = join(stateDir, 'herdr.json');
  const herdr = resolveHerdr(process.env, await readSavedHerdr(herdrFile));
  if (herdr.source === 'env' && herdr.socketPath !== undefined) await saveHerdr(herdrFile, { binPath: herdr.bin, socketPath: herdr.socketPath });
  // the program pastes nothing: without the socket a text to paste goes in typed
  const program = pasteAsTyped(createHerdrRunner(herdr));
  const note = `herdr: ${herdr.bin} — ${herdrSources[herdr.source]}. Without herdr the viewer only reads sessions.`;
  if (herdr.socketPath === undefined) return { run: program, via: 'program', note };
  return { run: socketRunner(createHerdrSocket(herdr.socketPath), program), via: 'socket', note: `${note} Talks to it through its socket.` };
}

/** @param {string} url */
export function openBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true })
    .on('error', () => console.log(`Open ${url} in your browser.`))
    .unref();
}
