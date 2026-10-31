// @ts-check
// A language's colours and structure for CodeMirror — a file's in the file panel's editor (code-editor.js), a code
// block's in a note (note-editor-cm.js) — its package loaded when code of it is first shown.
import { LanguageSupport, StreamLanguage } from '@codemirror/language';

/**
 * @typedef {import('../model/code-language.js').CodeLanguage} CodeLanguage
 */

/**
 * The language's colours and structure, its package loaded when code of it is first shown.
 * @param {CodeLanguage} language
 * @returns {Promise<LanguageSupport>}
 */
export async function languageSupport(language) {
  switch (language) {
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript();
    case 'jsx':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: true });
    case 'tsx':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true });
    case 'json':
      return (await import('@codemirror/lang-json')).json();
    case 'python':
      return (await import('@codemirror/lang-python')).python();
    case 'css':
      return (await import('@codemirror/lang-css')).css();
    case 'html':
      return (await import('@codemirror/lang-html')).html();
    case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown();
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql();
    case 'xml':
      return (await import('@codemirror/lang-xml')).xml();
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml();
    case 'rust':
      return (await import('@codemirror/lang-rust')).rust();
    case 'go':
      return (await import('@codemirror/lang-go')).go();
    case 'java':
      return (await import('@codemirror/lang-java')).java();
    case 'cpp':
      return (await import('@codemirror/lang-cpp')).cpp();
    case 'php':
      return (await import('@codemirror/lang-php')).php();
    case 'csharp':
      return legacy((await import('@codemirror/legacy-modes/mode/clike')).csharp);
    case 'kotlin':
      return legacy((await import('@codemirror/legacy-modes/mode/clike')).kotlin);
    case 'scala':
      return legacy((await import('@codemirror/legacy-modes/mode/clike')).scala);
    case 'shell':
      return legacy((await import('@codemirror/legacy-modes/mode/shell')).shell);
    case 'powershell':
      return legacy((await import('@codemirror/legacy-modes/mode/powershell')).powerShell);
    case 'toml':
      return legacy((await import('@codemirror/legacy-modes/mode/toml')).toml);
    case 'dockerfile':
      return legacy((await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile);
    case 'properties':
      return legacy((await import('@codemirror/legacy-modes/mode/properties')).properties);
    case 'lua':
      return legacy((await import('@codemirror/legacy-modes/mode/lua')).lua);
    case 'ruby':
      return legacy((await import('@codemirror/legacy-modes/mode/ruby')).ruby);
    case 'diff':
      return legacy((await import('@codemirror/legacy-modes/mode/diff')).diff);
    case 'nginx':
      return legacy((await import('@codemirror/legacy-modes/mode/nginx')).nginx);
    default: {
      /** @type {never} */
      const unknown = language;
      return unknown;
    }
  }
}

/**
 * A language of CodeMirror's legacy modes, as the others are given.
 * @param {import('@codemirror/language').StreamParser<unknown>} parser
 * @returns {LanguageSupport}
 */
function legacy(parser) {
  return new LanguageSupport(StreamLanguage.define(parser));
}
