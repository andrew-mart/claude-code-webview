// @ts-check
// A folder opened in the computer's file manager — Explorer, Finder, the desktop's own — for a browser on the viewer's
// computer; a file shown there in its folder, picked out where the file manager can.
import { spawn } from 'node:child_process';
import { posix, win32 } from 'node:path';

/**
 * @typedef {{ folder: string } | { path: string }} FileManagerTarget — a folder to open, or a file to show in its folder
 * @typedef {{ program: string, args: readonly string[], verbatim: boolean }} FileManagerLaunch — verbatim: the arguments
 *   go on Windows' command line as they are, quoted already
 */

/**
 * @param {FileManagerTarget} target
 * @param {NodeJS.Platform} platform
 * @returns {FileManagerLaunch}
 */
export function fileManagerLaunch(target, platform) {
  if (platform === 'win32') {
    // Explorer takes a file to pick out as one argument, its path quoted after the comma — a path holds no quote
    if ('folder' in target) return { program: 'explorer.exe', args: [win32.normalize(target.folder)], verbatim: false };
    return { program: 'explorer.exe', args: [`/select,"${win32.normalize(target.path)}"`], verbatim: true };
  }
  if (platform === 'darwin') return { program: 'open', args: 'folder' in target ? [target.folder] : ['-R', target.path], verbatim: false };
  // xdg-open has no way to pick a file out: its folder opens
  return { program: 'xdg-open', args: ['folder' in target ? target.folder : posix.dirname(target.path)], verbatim: false };
}

/**
 * The file manager opened, apart from the viewer.
 * @param {FileManagerTarget} target
 * @returns {Promise<boolean>} — whether it started
 */
export function openInFileManager(target) {
  const { program, args, verbatim } = fileManagerLaunch(target, process.platform);
  return new Promise((done) => {
    const child = spawn(program, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim });
    child.once('spawn', () => {
      child.unref();
      done(true);
    });
    child.once('error', () => done(false));
  });
}
