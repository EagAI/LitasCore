'use strict';

const { createWorker } = require('tesseract.js');

const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

/**
 * @param {string} url
 * @param {string} mime
 * @param {number} size
 * @returns {Promise<string|null>}
 */
async function ocrImage(url, mime, size) {
  const baseMime = (mime ?? '').split(';')[0].trim().toLowerCase();

  if (!ALLOWED_TYPES.has(baseMime)) return null;
  if (size > MAX_BYTES) return null;

  let buffer;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    buffer = Buffer.from(arrayBuf);
  } catch {
    return null;
  }

  const worker = await createWorker('eng', 1, {
    logger: () => {},
    errorHandler: () => {},
  });

  try {
    const {
      data: { text },
    } = await worker.recognize(buffer);
    return text ?? '';
  } catch {
    return null;
  } finally {
    await worker.terminate();
  }
}

module.exports = { ocrImage, MAX_BYTES, ALLOWED_TYPES };
