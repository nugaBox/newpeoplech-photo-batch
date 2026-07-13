// 행사 폴더에서 유효한 사진 파일만 수집한다.
const fs = require('fs');
const path = require('path');

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp|mpg|mpeg)$/i;

const MAGIC_CHECKS = [
  { name: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { name: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: 'bmp', bytes: [0x42, 0x4d] },
  { name: 'tiff-le', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { name: 'tiff-be', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
];

function readHeader(filePath, length = 12) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function matchesMagic(header, magicBytes) {
  if (header.length < magicBytes.length) return false;
  return magicBytes.every((b, i) => header[i] === b);
}

function isWebp(header) {
  return (
    header.length >= 12 &&
    header.toString('ascii', 0, 4) === 'RIFF' &&
    header.toString('ascii', 8, 12) === 'WEBP'
  );
}

function hasValidImageMagic(filePath) {
  const header = readHeader(filePath);
  if (MAGIC_CHECKS.some((m) => matchesMagic(header, m.bytes))) return true;
  if (isWebp(header)) return true;
  return false;
}

function isValidImageFile(filePath) {
  const base = path.basename(filePath);
  if (VIDEO_EXT.test(base)) return { ok: false, reason: 'video' };
  if (!IMAGE_EXT.test(base)) return { ok: false, reason: 'not_image_ext' };

  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) return { ok: false, reason: 'empty_or_missing' };

  try {
    if (!hasValidImageMagic(filePath)) return { ok: false, reason: 'invalid_magic' };
  } catch (err) {
    return { ok: false, reason: `read_error:${err.message}` };
  }

  return { ok: true };
}

function collectPhotosFromFolder(folderPath) {
  const skipped = [];
  const photos = fs
    .readdirSync(folderPath)
    .map((name) => path.join(folderPath, name))
    .filter((p) => fs.statSync(p).isFile())
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .filter((filePath) => {
      const result = isValidImageFile(filePath);
      if (!result.ok) {
        skipped.push({ file: path.basename(filePath), reason: result.reason });
        return false;
      }
      return true;
    });

  return { photos, skipped };
}

module.exports = {
  IMAGE_EXT,
  VIDEO_EXT,
  isValidImageFile,
  collectPhotosFromFolder,
};
