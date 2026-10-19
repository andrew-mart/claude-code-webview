// @ts-check
// A window brought before its user on Windows, though the process that opened it runs in the background.
import { spawn } from 'node:child_process';

/**
 * Windows keeps a window that a process in the background — the viewer started with --background — has the file opened
 * in behind the browser the button was pressed in: the editor's window is brought to the front, attaching for a moment
 * to the input of the window in front, as Windows lets a process do then. Tried for a while, as an editor that was not
 * running takes time to show its window; if it never does, nothing happens.
 * @param {string} name — the program's process, its name without .exe: its window is its main one
 */
export function bringForward(name) {
  const script = `
Add-Type -Name Window -Namespace Viewer -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr window, System.IntPtr process);
[DllImport("kernel32.dll")] public static extern int GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(int from, int to, bool attach);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr window);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr window);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr window);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr window, int how);
'@
for ($try = 0; $try -lt 40; $try++) {
  Start-Sleep -Milliseconds 500
  $editor = Get-Process -Name '${name.replaceAll("'", "''")}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($editor -eq $null) { continue }
  $window = $editor.MainWindowHandle
  if ([Viewer.Window]::IsIconic($window)) { [void][Viewer.Window]::ShowWindow($window, 9) }
  $front = [Viewer.Window]::GetWindowThreadProcessId([Viewer.Window]::GetForegroundWindow(), [System.IntPtr]::Zero)
  $me = [Viewer.Window]::GetCurrentThreadId()
  [void][Viewer.Window]::AttachThreadInput($me, $front, $true)
  [void][Viewer.Window]::BringWindowToTop($window)
  $done = [Viewer.Window]::SetForegroundWindow($window)
  [void][Viewer.Window]::AttachThreadInput($me, $front, $false)
  if ($done) { break }
}`;
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => undefined).unref();
}
