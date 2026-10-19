import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createVsCode, desktopVsCode, serversOf } from '../server/vscode.js';

const fakeServeWeb = join(import.meta.dirname, '..', 'test-support', 'fake-serve-web.mjs');

/**
 * VS Code's web server as the viewer starts it — here the stand-in — let go of after the test.
 * @param {import('node:test').TestContext} t
 * @param {readonly string[]} [command]
 */
async function vsCodeOf(t, command = [process.execPath, fakeServeWeb]) {
  const dir = tempDir('ccw-vscode-');
  const vscode = createVsCode({ command, desktop: command, tokenFile: join(dir, 'token'), bringForward: () => undefined });
  t.after(() => vscode.close());
  return vscode;
}

/** What the server says of a request to it with this token. @param {number} port @param {string | undefined} token */
async function ask(port, token) {
  const response = await fetch(`http://127.0.0.1:${port}/vscode/workbench`, { headers: token === undefined ? {} : { cookie: `vscode-tkn=${token}` } });
  return response.status;
}

// VS Code's web server starts the first time it is asked for, once, on a port of 127.0.0.1, under /vscode, answering
// only with its token — which only the viewer holds
test('vsCode_Should_StartOnce_OnLocalPortUnderVscode_AnsweringOnlyWithItsToken', async (t) => {
  const vscode = await vsCodeOf(t);

  const first = await vscode.target();
  const again = await vscode.target();

  assert.ok(first !== undefined && again !== undefined);
  assert.deepEqual({ same: again.port === first.port, withToken: await ask(first.port, first.token), without: await ask(first.port, undefined) }, { same: true, withToken: 200, without: 403 });
});

// A server that stopped is started again the next time it is asked for
test('vsCode_Should_StartAgain_When_ItHasStopped', async (t) => {
  const vscode = await vsCodeOf(t);
  const first = await vscode.target();
  assert.ok(first !== undefined);
  await fetch(`http://127.0.0.1:${first.port}/vscode/exit`, { headers: { cookie: `vscode-tkn=${first.token}` } }).catch(() => undefined);
  await new Promise((done) => setTimeout(done, 300));

  const next = await vscode.target();

  assert.ok(next !== undefined);
  assert.equal(await ask(next.port, next.token), 200);
});

// The computer's own VS Code is opened by the same command — for a browser on the viewer's computer — at the folder, a
// file in it gone to at its line; a program missing starts nothing
test('vsCode_Should_OpenComputersOwnVsCode_AtFolderWithFileAtItsLine', async (t) => {
  const told = join(tempDir('ccw-vscode-desktop-'), 'opened.json');
  process.env.FAKE_VSCODE_OPENED = told;
  t.after(() => delete process.env.FAKE_VSCODE_OPENED);
  const given = async () => {
    for (let waited = 0; waited < 5000; waited += 50) {
      const written = await readFile(told, 'utf8').catch(() => undefined);
      if (written !== undefined) {
        await rm(told);
        return JSON.parse(written);
      }
      await new Promise((done) => setTimeout(done, 50));
    }
    return undefined;
  };
  const vscode = await vsCodeOf(t);
  const missing = await vsCodeOf(t, ['no-such-vscode-cli-here']);

  const atLine = { started: await vscode.openDesktop('D:/dev/shop', { path: 'D:/dev/shop/src/cart.js', line: 12 }), given: await given() };
  const atTop = { started: await vscode.openDesktop('D:/dev/shop', { path: 'D:/dev/shop/README.md', line: undefined }), given: await given() };
  const folder = { started: await vscode.openDesktop('D:/dev/shop', undefined), given: await given() };

  assert.deepEqual([atLine, atTop, folder, await missing.openDesktop('D:/dev/shop', undefined)], [
    { started: true, given: ['D:/dev/shop', '--goto', 'D:/dev/shop/src/cart.js:12'] },
    { started: true, given: ['D:/dev/shop', '--goto', 'D:/dev/shop/README.md'] },
    { started: true, given: ['D:/dev/shop'] },
    false,
  ]);
});

// The computer's own VS Code is opened on Windows by its program beside the bin folder the CLI is in — the CLI may not
// find the installation — the Insiders' too; elsewhere the CLI, `code`, opens it; a CLI on Windows that is not in VS
// Code's bin folder opens none
test('desktopVsCode_Should_TakeVsCodesProgram_OnWindows_AndTheCliElsewhere', () => {
  assert.deepEqual(
    [
      desktopVsCode('C:\\Users\\ann\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code-tunnel.exe', 'win32'),
      desktopVsCode('C:/Programs/Microsoft VS Code Insiders/bin/code-tunnel-insiders.exe', 'win32'),
      desktopVsCode('D:/tools/code-tunnel.exe', 'win32'),
      desktopVsCode('code', 'linux'),
    ],
    [win32.join('C:\\Users\\ann\\AppData\\Local\\Programs\\Microsoft VS Code', 'Code.exe'), win32.join('C:/Programs/Microsoft VS Code Insiders', 'Code - Insiders.exe'), undefined, 'code'],
  );
});

// No such program: no VS Code to reach
test('vsCode_Should_GiveNothing_When_ProgramIsMissing', async (t) => {
  const vscode = await vsCodeOf(t, ['no-such-vscode-cli-here']);

  assert.equal(await vscode.target(), undefined);
});

// However the viewer goes — stopped by --stop, which on Windows leaves a process's children running, or fallen — the
// VS Code it started goes too, with the server VS Code started
test('vscodeGuard_Should_TakeServerDown_When_ViewerIsGone', async (t) => {
  const dir = tempDir('ccw-guard-');
  const tokenFile = join(dir, 'token');
  await writeFile(tokenFile, 'guarded');
  const viewer = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  t.after(() => viewer.kill());
  const port = 7000 + Math.floor(Math.random() * 2000);
  const guard = spawn(process.execPath, [join(import.meta.dirname, '..', 'server', 'vscode-guard.js'), String(viewer.pid), process.execPath, fakeServeWeb, 'serve-web', '--host', '127.0.0.1', '--port', String(port), '--connection-token-file', tokenFile, '--server-base-path', '/vscode'], { stdio: 'ignore' });
  t.after(() => guard.kill());
  const answering = async () => (await fetch(`http://127.0.0.1:${port}/vscode/x`, { headers: { cookie: 'vscode-tkn=guarded' } }).catch(() => undefined))?.status === 200;
  const until = async (/** @type {boolean} */ wanted) => {
    for (let tries = 0; tries < 200; tries++) {
      if ((await answering()) === wanted) return true;
      await new Promise((done) => setTimeout(done, 100));
    }
    return false;
  };

  const startedWhileViewerRuns = await until(true);
  viewer.kill();
  const goneWithViewer = await until(false);

  assert.deepEqual({ startedWhileViewerRuns, goneWithViewer }, { startedWhileViewerRuns: true, goneWithViewer: true });
});

// VS Code's server outlives the CLI that started it — on Windows out of its process tree — so it is told by the token
// file in its command line: stopping VS Code stops it, with what it started; nothing of another viewer is touched
test('vsCode_Should_StopItsServerOutOfTree_ByTokenFile_LeavingOthersAlone', async (t) => {
  const dir = tempDir('ccw-leftover-');
  const tokenFile = join(dir, 'vscode-token-7788');
  const lingering = (/** @type {string} */ file) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', '--connection-token-file', file], { detached: true, stdio: 'ignore' });
    child.unref();
    return child.pid ?? 0;
  };
  const alive = (/** @type {number} */ pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const ours = lingering(tokenFile);
  const another = lingering(join(dir, 'vscode-token-7891'));
  t.after(() => {
    for (const pid of [ours, another]) if (alive(pid)) process.kill(pid);
  });
  const vscode = createVsCode({ command: [process.execPath, fakeServeWeb], desktop: undefined, tokenFile, bringForward: () => undefined });

  vscode.close();
  await new Promise((done) => setTimeout(done, 500));

  assert.deepEqual({ ours: alive(ours), another: alive(another) }, { ours: false, another: true });
});

// Starting VS Code first looks over the computer's processes for a server left behind — on Windows it takes seconds — and
// the viewer answers its pages meanwhile: the request that starts it does not hold it
test('vsCode_Should_LeaveViewerAnswering_WhileItLooksForServersLeftBehind', async (t) => {
  const vscode = await vsCodeOf(t);

  const before = performance.now();
  const started = vscode.target();
  const held = performance.now() - before;
  await started;

  // starting the listing process itself takes a moment — under load a few hundred ms; the listing, seconds
  assert.ok(held < 2000, `the start held the viewer for ${Math.round(held)} ms`);
});

// On Windows a process keeps its parent's number after the parent is gone, and the number goes to a process started
// later: a viewer whose launcher has exited is not a child of the server that got the launcher's number
test('serversOf_Should_TakeWhatTheServerStarted_NotWhatBeganBeforeItUnderItsNumber', () => {
  const tokenFile = 'C:\\state\\vscode-token-7788';
  const table = [
    { pid: 12, ppid: 8, started: 5000, command: `code-tunnel.exe serve-web --connection-token-file ${tokenFile} --port 9` },
    { pid: 20, ppid: 12, started: 5100, command: 'node server-main.js' },
    { pid: 21, ppid: 20, started: 5200, command: 'node extension-host.js' },
    // a viewer and its gate, their launcher — number 12 once — long gone
    { pid: 40, ppid: 12, started: 1000, command: 'node claude-code-webview.js --port 41000' },
    { pid: 41, ppid: 40, started: 1100, command: 'node vscode-guard.js' },
    { pid: 42, ppid: 12, started: 1000, command: 'node launch.js --remote' },
    { pid: 50, ppid: 8, started: 5000, command: 'code-tunnel.exe serve-web --connection-token-file C:\\state\\vscode-token-7891' },
  ];

  assert.deepEqual([...serversOf(table, tokenFile, 99)].sort((a, b) => a - b), [12, 20, 21]);
});
