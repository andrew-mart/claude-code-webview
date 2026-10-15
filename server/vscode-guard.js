// @ts-check
// Runs VS Code's web server for the viewer and takes it down — with the server it started — once the viewer is gone,
// however it went: --stop on Windows ends a process without a word, and the processes it started live on.
//   node vscode-guard.js <viewer's pid> <program> [arguments…]
import { execFile, spawn } from 'node:child_process';
import { stopServersNow } from './vscode.js';

/** How often the guard looks whether the viewer still runs. */
const lookEveryMs = 2000;

const [viewerPid, program, ...args] = process.argv.slice(2);
if (viewerPid === undefined || program === undefined) process.exit(2);
// in the guard's own process group off Windows: the viewer stops the guard's group, and the guard its own
const child = spawn(program, args, { stdio: 'ignore', windowsHide: true });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', () => process.exit(1));

/** The token file VS Code is started with: it tells VS Code's server, which lives out of the tree on Windows. */
const tokenFile = args[args.indexOf('--connection-token-file') + 1];

/** VS Code's server and what it started, then the guard. */
const stop = () => {
  if (tokenFile !== undefined && args.includes('--connection-token-file')) stopServersNow(tokenFile);
  if (process.platform === 'win32' && child.pid !== undefined) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => process.exit(0));
    return;
  }
  try {
    // the group's signal comes to the guard too: it ends it, not this again
    process.removeAllListeners('SIGTERM');
    process.kill(-process.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
    process.exit(0);
  }
};
process.on('SIGTERM', stop);
setInterval(() => {
  try {
    // signal 0 sends nothing: it only tells whether the process is there
    process.kill(Number(viewerPid), 0);
  } catch {
    stop();
  }
}, lookEveryMs);
