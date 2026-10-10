// @ts-check
// Images attached in the prompt box: picked from files or the camera, pasted or dropped; shown as thumbnails until sent.
import { h } from './dom.js';
import { icon } from './icons.js';

/** @typedef {{ mediaType: string, data: string }} AttachedImage — base64 bytes, as /api/send takes them */

/** A phone photo is scaled down to this long side: enough for Claude to read it, far lighter to send. */
const maxSide = 2048;
/** An image already this small and in a format Claude reads is sent unchanged — a screenshot keeps its sharpness. */
const keepBytes = 1.5 * 1024 * 1024;
const keptTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * @param {{ onChange: () => void, onError: (message: string) => void }} hooks
 */
export function createAttachmentPicker({ onChange, onError }) {
  const input = h('input', { attrs: { type: 'file', accept: 'image/*', multiple: '', hidden: '' } });
  const button = h('button', { className: 'composer-attach', title: 'Attach images', attrs: { type: 'button', 'aria-label': 'Attach images' } }, [icon('attach')]);
  const list = h('div', { className: 'composer-attachments', attrs: { hidden: '' } });
  /** @type {readonly AttachedImage[]} */
  let images = [];

  const render = () => {
    list.hidden = images.length === 0;
    list.replaceChildren(
      ...images.map((image) => {
        const preview = h('img', { attrs: { alt: '' } });
        preview.src = `data:${image.mediaType};base64,${image.data}`;
        const remove = h('button', { className: 'attachment-remove', title: 'Remove', attrs: { type: 'button', 'aria-label': 'Remove image' } }, [icon('cross')]);
        remove.addEventListener('click', () => {
          images = images.filter((other) => other !== image);
          render();
          onChange();
        });
        return h('div', { className: 'attachment' }, [preview, remove]);
      }),
    );
  };

  /** @param {readonly File[]} files */
  const add = async (files) => {
    for (const file of files.filter((candidate) => candidate.type.startsWith('image/'))) {
      const image = await prepare(file).catch(() => undefined);
      if (image === undefined) onError(`Could not read ${file.name} as an image.`);
      else images = [...images, image];
    }
    render();
    onChange();
  };
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    void add([...(input.files ?? [])]);
    input.value = '';
  });

  return {
    button,
    list,
    input,
    add,
    images: () => images,
    clear() {
      images = [];
      render();
    },
  };
}

/**
 * A photo from a phone weighs megabytes: it is scaled down and re-encoded as JPEG; a small image in a format Claude
 * reads goes as it is.
 * @param {File} file
 * @returns {Promise<AttachedImage>}
 */
async function prepare(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= keepBytes && keptTypes.has(file.type)) {
    bitmap.close();
    return { mediaType: file.type, data: await base64(file) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('The browser gave no 2D canvas to scale the image on');
  // JPEG has no transparency: transparent parts of a PNG become white, not black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  /** @type {Blob} */
  const jpeg = await new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob === null ? reject(new Error('The image could not be encoded as JPEG')) : resolve(blob)), 'image/jpeg', 0.85),
  );
  return { mediaType: 'image/jpeg', data: await base64(jpeg) };
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function base64(blob) {
  /** @type {string} */
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}
