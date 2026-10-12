// @ts-check
// A herdr tab's icon: an emoji ahead of its name, kept in the tab's label — so herdr shows it too.

/** The emoji a tab's icon is picked from. */
export const tabIcons = /** @type {const} */ (['🚀', '🐞', '🧪', '🔧', '📝', '📚', '💡', '🔥', '⭐', '✅', '🎨', '📦', '🔒', '🌐', '🤖', '📊', '🗂️', '⚙️', '🧹', '💬']);

/**
 * An emoji leading a label: a picture, its variation and skin tone, and the pictures joined to it (👩‍💻).
 */
const leadingIcon = /^(\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*)\s*/u;

/**
 * @param {string} label — a tab's label in herdr
 * @returns {{ icon: string | undefined, name: string }}
 */
export function splitTabIcon(label) {
  const icon = leadingIcon.exec(label)?.[1];
  return icon === undefined ? { icon: undefined, name: label } : { icon, name: label.slice(label.indexOf(icon) + icon.length).trim() };
}

/**
 * @param {string | undefined} icon
 * @param {string} name
 */
export function labelWithIcon(icon, name) {
  return [icon, name.trim()].filter((part) => part !== undefined && part !== '').join(' ');
}
