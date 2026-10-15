// @ts-check
// Whether a line of code defines a name or only uses it, told by the line's own words, in the languages a project is
// usually written in — JavaScript and TypeScript, Python, C#, Java, Go, Rust, C. A search for the name's uses finds
// its definitions among them: no language server, the text alone, close enough to go to.

/** The words before a name a declaration may carry. */
const modifiers = '(?:export|default|declare|abstract|public|private|protected|internal|static|readonly|sealed|override|virtual|async|partial|final|pub(?:\\([^)]*\\))?|unsafe|extern|inline|const|get|set)';

/**
 * The shapes of a definition, the name in place of NAME.
 * @type {readonly string[]}
 */
const shapes = [
  // function, class, type and the like: the keyword, then the name
  `\\b(?:function\\*?|class|interface|type|enum|struct|trait|record|namespace|module|object|def|fn|union|impl)\\s+NAME\\b`,
  // a variable or a constant given a value
  `\\b(?:const|let|var|val)\\s+NAME\\b\\s*(?::[^=]*)?=`,
  // Go: a function, a method on its receiver
  `\\bfunc\\s+(?:\\([^)]*\\)\\s*)?NAME\\s*\\(`,
  // a name given a function: an arrow, a function expression
  `(?:^|[\\s.{,])NAME\\s*[:=]\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`,
  // a method in a class or an object: the head alone on its line, its body opening
  `^\\s*(?:${modifiers}\\s+)*\\*?NAME\\s*\\([^)]*\\)\\s*(?::\\s*[^{;=]+)?\\{\\s*$`,
  // a typed declaration — C#, Java, C: modifiers, a type, the name — a method's head or a field given a value
  `^\\s*(?:${modifiers}\\s+)+[\\w<>\\[\\],.?]+(?:\\s+[\\w<>\\[\\],.?]+)?\\s+NAME\\s*(?:\\(|=|;)`,
  // JSDoc's type
  `@typedef\\s+\\{.*\\}\\s+NAME\\b`,
  // C's macro
  `^\\s*#\\s*define\\s+NAME\\b`,
];

/**
 * @param {string} name — a word of code: letters, digits, _ and $ — or whatever is selected, looked for as written
 * @param {string} line
 * @returns {boolean}
 */
export function isDefinition(name, line) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return shapes.some((shape) => new RegExp(shape.replaceAll('NAME', escaped)).test(line));
}
