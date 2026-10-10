// @ts-check
// Images attached to prompts from the page: saved as files that Claude Code opens by path, and shown in the feed.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord } from '../public/model/narrow.js';

/**
 * Raster images only: an SVG served from the viewer's own address could run a script in its page.
 * @typedef {'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'} ImageType
 * @typedef {{ mediaType: ImageType, bytes: Buffer }} Image
 */

/** @type {Readonly<Record<ImageType, string>>} */
const extensionOf = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
/** @type {Readonly<Record<string, ImageType>>} */
const typeOf = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
/** The names the viewer gives saved images; nothing else is served from the folder. */
const savedName = /^[\w-]+\.(png|jpg|gif|webp)$/;
const maxImages = 10;
const maxImageBytes = 15 * 1024 * 1024;

/**
 * The images of a send request; anything but a short list of base64 raster images refuses the whole request.
 * @param {unknown} value — body.images, absent when nothing is attached
 * @returns {{ ok: true, images: Image[] } | { ok: false, error: string }}
 */
export function parseImages(value) {
  if (value === undefined) return { ok: true, images: [] };
  if (!Array.isArray(value) || value.length > maxImages) return { ok: false, error: `Attach at most ${maxImages} images at a time.` };
  /** @type {Image[]} */
  const images = [];
  for (const item of value) {
    const mediaType = isRecord(item) ? item.mediaType : undefined;
    const data = isRecord(item) ? item.data : undefined;
    if (!isImageType(mediaType) || typeof data !== 'string') return { ok: false, error: 'Only PNG, JPEG, GIF and WebP images can be attached.' };
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0 || bytes.length > maxImageBytes) return { ok: false, error: `An attached image must be under ${maxImageBytes / 1024 / 1024} MB.` };
    images.push({ mediaType, bytes });
  }
  return { ok: true, images };
}

/**
 * @param {string} dir — ~/.claude-code-webview/uploads
 */
export function createUploads(dir) {
  return {
    /**
     * @param {readonly Image[]} images
     * @returns {Promise<string[]>} — absolute paths of the saved files, in the same order
     */
    async save(images) {
      if (images.length === 0) return [];
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
      return Promise.all(
        images.map(async (image) => {
          const path = join(dir, `${stamp}-${randomBytes(4).toString('hex')}.${extensionOf[image.mediaType]}`);
          await writeFile(path, image.bytes, { flag: 'wx' });
          return path;
        }),
      );
    },
    /** @param {readonly string[]} paths */
    async remove(paths) {
      await Promise.all(paths.map((path) => rm(path, { force: true })));
    },
    /**
     * @param {string} name — a file name from /api/upload/<name>
     * @returns {Promise<Image | undefined>} — undefined for a name the viewer could not have given, or a missing file
     */
    async read(name) {
      const extension = savedName.exec(name)?.[1];
      const mediaType = extension === undefined ? undefined : typeOf[extension];
      if (mediaType === undefined) return undefined;
      const bytes = await readFile(join(dir, name)).catch(() => undefined);
      return bytes === undefined ? undefined : { mediaType, bytes };
    },
  };
}

/**
 * @param {unknown} value
 * @returns {value is ImageType}
 */
function isImageType(value) {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/gif' || value === 'image/webp';
}
