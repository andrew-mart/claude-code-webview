// @ts-check
// A row marked with the colour of the herdr workspace it belongs to, on its left edge (style.css: .tinted).
import { workspaceHue } from '../model/workspace-color.js';

/**
 * @param {HTMLElement} row
 * @param {string | undefined} workspace — the workspace's name; none leaves the row untinted
 */
export function tintByWorkspace(row, workspace) {
  row.classList.toggle('tinted', workspace !== undefined);
  if (workspace === undefined) row.style.removeProperty('--workspace-hue');
  else row.style.setProperty('--workspace-hue', String(workspaceHue(workspace)));
}
