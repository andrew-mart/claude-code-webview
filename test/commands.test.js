import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { claudeCommands, codexCommands } from '../server/commands.js';

/** @param {string} file @param {string} text */
async function put(file, text) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

/**
 * A Claude config folder and a project: skills and commands of the user's own and of the project's, and plugins — one
 * laid out as plugins are by default, one naming its folders, one turned off.
 */
async function setUp() {
  const root = tempDir('commands-');
  const config = join(root, 'claude');
  const project = join(root, 'shop');
  const plugins = join(root, 'plugins');
  await put(join(config, 'skills', 'tdd', 'SKILL.md'), '---\nname: tdd\ndescription: "Test-driven development: red, green, refactor"\nargument-hint: "[feature]"\n---\nBody');
  await put(join(config, 'skills', 'notes', 'SKILL.md'), '---\ndescription: >\n  Keeps notes\n  of the day\n---\n');
  await put(join(config, 'commands', 'deploy.md'), '---\ndescription: Deploy the app\nargument-hint: <env>\n---\nDeploy to $ARGUMENTS');
  await put(join(config, 'commands', 'frontend', 'component.md'), '\n\nMake a React component named $ARGUMENTS\n');
  await put(join(project, '.claude', 'skills', 'tdd', 'SKILL.md'), '---\nname: tdd\ndescription: The project own TDD\n---\n');
  await put(join(project, '.claude', 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review the change\n---\n');
  await put(join(project, '.claude', 'commands', 'fix.md'), '---\ndescription: Fix an issue\n---\n');
  await put(join(plugins, 'superpowers', 'skills', 'brainstorming', 'SKILL.md'), '---\nname: brainstorming\ndescription: Explore an idea first\n---\n');
  await put(join(plugins, 'kit', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'kit', commands: ['./.claude/commands'], skills: ['./skills/engineering/tdd'] }));
  await put(join(plugins, 'kit', '.claude', 'commands', 'build.md'), '---\ndescription: Build it\n---\n');
  await put(join(plugins, 'kit', 'skills', 'engineering', 'tdd', 'SKILL.md'), '---\nname: tdd\ndescription: Kit TDD\n---\n');
  await put(join(plugins, 'off', 'skills', 'hidden', 'SKILL.md'), '---\nname: hidden\ndescription: Not on\n---\n');
  const installed = (/** @type {string} */ folder) => [{ scope: 'user', installPath: join(plugins, folder) }];
  await put(join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'superpowers@official': installed('superpowers'), 'kit@other': installed('kit'), 'off@official': installed('off') } }));
  await put(join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@official': true, 'kit@other': true, 'off@official': false } }));
  return { config, project };
}

// What the "/" of a Claude Code session offers: its built-in commands, the user's own skills and commands — a command's
// subfolder its namespace — the project's, and the skills and commands of the plugins turned on, named after their
// plugin; a skill of the user's own goes before the project's of the same name; a description is the frontmatter's, or a
// command file's first line
test('claudeCommands_Should_OfferBuiltInsSkillsCommandsAndPluginsOn_ForSessionsFolder', async () => {
  const { config, project } = await setUp();

  const offered = await claudeCommands({ config, cwd: project });
  const own = offered.filter((command) => command.source !== 'built-in');

  assert.deepEqual(
    { compact: offered.find((command) => command.name === '/compact')?.source, own },
    {
      compact: 'built-in',
      own: [
        { name: '/deploy', hint: '<env>', about: 'Deploy the app', source: 'personal' },
        { name: '/fix', hint: '', about: 'Fix an issue', source: 'project' },
        { name: '/frontend:component', hint: '', about: 'Make a React component named $ARGUMENTS', source: 'personal' },
        { name: '/kit:build', hint: '', about: 'Build it', source: 'kit' },
        { name: '/kit:tdd', hint: '', about: 'Kit TDD', source: 'kit' },
        { name: '/notes', hint: '', about: 'Keeps notes of the day', source: 'personal' },
        { name: '/review', hint: '', about: 'Review the change', source: 'project' },
        { name: '/superpowers:brainstorming', hint: '', about: 'Explore an idea first', source: 'superpowers' },
        { name: '/tdd', hint: '[feature]', about: 'Test-driven development: red, green, refactor', source: 'personal' },
      ],
    },
  );
});

// What the "/" of a Codex session offers: Codex's built-in commands, and the user's own prompts as /prompts:<name>
test('codexCommands_Should_OfferBuiltInsAndUsersPrompts', async () => {
  const home = join(tempDir('codex-commands-'), 'codex');
  await put(join(home, 'prompts', 'fix.md'), '---\ndescription: Fix the failing test\nargument-hint: [test]\n---\nFix $ARGUMENTS');

  const offered = await codexCommands({ home });

  assert.deepEqual(
    { review: offered.find((command) => command.name === '/review')?.source, prompts: offered.filter((command) => command.source !== 'built-in') },
    { review: 'built-in', prompts: [{ name: '/prompts:fix', hint: '[test]', about: 'Fix the failing test', source: 'personal' }] },
  );
});
