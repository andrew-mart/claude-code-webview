// @ts-check
// The "Claude Code Webview" shortcut on the desktop or in the Start menu (Windows only).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * A copy of the package in the npx cache is temporary: npm may delete it, and a shortcut to it would stop working.
 * @param {string} scriptPath — path to the command's entry script
 * @returns {boolean}
 */
export function isTemporaryInstall(scriptPath) {
  return /[\\/]_npx[\\/]/.test(scriptPath);
}

/**
 * The shortcut runs node with the command in the background (--background): the window is minimized, the console only flashes in the taskbar.
 * Windows provides the folder (the desktop may be relocated, e.g. to OneDrive). Paths are inserted into the PowerShell
 * script in single quotes; a quote inside a path is doubled.
 * @param {{ scriptPath: string, iconPath: string, workingDir: string, folder: 'Desktop' | 'Programs' }} options
 * @returns {Promise<string>} — path to the created shortcut
 */
export async function installShortcut({ scriptPath, iconPath, workingDir, folder }) {
  const quote = (/** @type {string} */ value) => `'${value.replaceAll("'", "''")}'`;
  const script = [
    `$folder = [Environment]::GetFolderPath('${folder}')`,
    "$link = Join-Path $folder 'Claude Code Webview.lnk'",
    '$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)',
    `$shortcut.TargetPath = ${quote(process.execPath)}`,
    `$shortcut.Arguments = ${quote(`"${scriptPath}" --background`)}`,
    `$shortcut.WorkingDirectory = ${quote(workingDir)}`,
    `$shortcut.IconLocation = ${quote(iconPath)}`,
    "$shortcut.Description = 'Claude Code sessions in the browser'",
    '$shortcut.WindowStyle = 7',
    '$shortcut.Save()',
    'Write-Output $link',
  ].join('; ');
  const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  return stdout.trim();
}
