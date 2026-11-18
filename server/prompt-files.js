// @ts-check
// Prompts sent through a file: one the agent's terminal took cut short goes whole into a file, and the terminal gets
// only a line telling the agent to read it there.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @param {string} dir — ~/.claude-code-webview/prompts
 */
export function createPromptFiles(dir) {
  return {
    /**
     * @param {string} text — the prompt as the page sent it
     * @returns {Promise<string>} — the absolute path of the file it is in
     */
    async save(text) {
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
      const path = join(dir, `${stamp}-${randomBytes(4).toString('hex')}.md`);
      await writeFile(path, text, { flag: 'wx' });
      return path;
    },
  };
}

/**
 * The line the agent's terminal gets in place of a prompt put in a file: short enough to come in one read.
 * @param {string} path — where the prompt is
 */
export function readPromptLine(path) {
  return `The prompt is in the file ${path}: read it whole and do what it says.`;
}
