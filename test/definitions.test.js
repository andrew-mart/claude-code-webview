import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDefinition } from '../public/model/definitions.js';

// A line that defines the name — a function, a class or type, a method, a variable, in the languages a project is
// written in — is its definition; a line that only uses it — a call, an import, a mention — is not
test('isDefinition_Should_TellLineDefiningNameFromOneUsingIt', () => {
  const lines = {
    defining: [
      'export function createProjectView({ root, listFolder }) {',
      'export async function* createProjectView(dir) {',
      'const createProjectView = ({ root }) => {',
      'let createProjectView = function () {',
      '  createProjectView: async (source) => {',
      '  createProjectView(source) {',
      '  async createProjectView(source) {',
      'export default class createProjectView extends View {',
      'interface createProjectView {',
      'export type createProjectView = { root: string };',
      ' * @typedef {{ root: string }} createProjectView — a source',
      'def createProjectView(root):',
      'class createProjectView(Base):',
      'fn createProjectView(root: &str) -> View {',
      'pub struct createProjectView {',
      'func (s *Server) createProjectView(root string) View {',
      'type createProjectView struct {',
      '    public async Task<View> createProjectView(string root)',
      '    private static readonly int createProjectView = 3;',
      'public sealed record createProjectView(string Root);',
      '#define createProjectView 1',
    ],
    using: [
      "import { createProjectView } from './project-view.js';",
      '  const project = createProjectView({ ...source, openFile: openFromList });',
      '  return createProjectView(source);',
      '  if (createProjectView(source)) {',
      '// createProjectView draws the tree',
      'const view = await createProjectView(source);',
      "const { createProjectView } = await import('../public/view/project-view.js');",
      '    var view = createProjectView(root);',
    ],
  };

  assert.deepEqual(
    { defining: lines.defining.filter((line) => !isDefinition('createProjectView', line)), using: lines.using.filter((line) => isDefinition('createProjectView', line)) },
    { defining: [], using: [] },
  );
});

// A selection that is not a bare name — a parenthesis, a bar, a dot — is looked for as written: it neither breaks the
// search nor finds lines it is not in
test('isDefinition_Should_TakeSelectionWithPatternCharactersAsWritten', () => {
  assert.deepEqual([isDefinition('foo(', 'function foo() {}'), isDefinition('x|y', 'const y = 1;'), isDefinition('a.b', 'const aXb = 1;')], [false, false, false]);
});
