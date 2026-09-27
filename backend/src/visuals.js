// Question visuals on the server (ADR 0007). Loads the same kind files the
// pages draw with (web/visuals/kinds/*.js), so boot validation, the student
// projection and the drawing all read one definition per kind. Adding a
// kind means adding a file there, not editing this one.
//
// This file adds what needs the file system: an illustration's image must
// exist, be a WebP of at most MAX_IMAGE_BYTES, be no larger than MAX_IMAGE_SIDE
// on its longer side, and carry no chunk but the image data, because
// generators embed their prompt and provenance manifests in metadata and
// image files are public.

const fs = require("fs");
const path = require("path");
const core = require("../../web/visuals/visuals.js");

const WEB_VISUALS_DIR = path.resolve(__dirname, "../../web/visuals");
const KINDS_DIR = path.join(WEB_VISUALS_DIR, "kinds");
const DEFAULT_IMAGE_DIR = path.join(WEB_VISUALS_DIR, "img");
const MAX_IMAGE_BYTES = 100 * 1024;
const MAX_IMAGE_SIDE = 640;
// The only RIFF chunks a shipped image may hold: the image data itself.
// EXIF, XMP, ICCP and anything unknown are refused.
const IMAGE_CHUNKS = ["VP8 ", "VP8L", "VP8X", "ALPH"];

fs.readdirSync(KINDS_DIR)
  .filter(name => name.endsWith(".js"))
  .sort()
  .forEach(name => core.register(require(path.join(KINDS_DIR, name))));

// Reads a WebP's chunk list and size. Returns { chunks, width, height } or
// { error }.
function inspectWebp(buffer) {
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return { error: "is not a WebP file" };
  }

  const chunks = [];
  let width = null;
  let height = null;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const fourcc = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    chunks.push(fourcc);

    if (fourcc === "VP8 " && size >= 10) {
      width = buffer.readUInt16LE(data + 6) & 0x3fff;
      height = buffer.readUInt16LE(data + 8) & 0x3fff;
    } else if (fourcc === "VP8L" && size >= 5) {
      const bits = buffer.readUInt32LE(data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    } else if (fourcc === "VP8X" && size >= 10) {
      width = buffer.readUIntLE(data + 4, 3) + 1;
      height = buffer.readUIntLE(data + 7, 3) + 1;
    }

    offset = data + size + (size % 2);
  }

  return { chunks, width, height };
}

function checkImageFile(src, imageDir) {
  const file = path.join(imageDir, src);

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return [`visual (illustration) file ${src} does not exist in web/visuals/img/`];
  }

  const buffer = fs.readFileSync(file);
  const errors = [];

  if (buffer.length > MAX_IMAGE_BYTES) {
    errors.push(`visual (illustration) file ${src} is ${Math.round(buffer.length / 1024)} KB; the limit is ${MAX_IMAGE_BYTES / 1024} KB`);
  }

  const info = inspectWebp(buffer);

  if (info.error) {
    return errors.concat(`visual (illustration) file ${src} ${info.error}`);
  }

  const extra = info.chunks.filter(chunk => !IMAGE_CHUNKS.includes(chunk));
  if (extra.length) {
    errors.push(`visual (illustration) file ${src} carries metadata (${extra.join(", ").trim()}); re-encode it with cwebp -metadata none`);
  }
  if (!info.width || Math.max(info.width, info.height) > MAX_IMAGE_SIDE) {
    errors.push(`visual (illustration) file ${src} is ${info.width} by ${info.height}; at most ${MAX_IMAGE_SIDE} pixels on the longer side`);
  }

  return errors;
}

// Every problem with one question's visual, as strings for the boot report.
function validateQuestionVisual(question, { imageDir = DEFAULT_IMAGE_DIR } = {}) {
  if (question.visual === undefined) {
    return [];
  }

  const errors = core.validate(question.visual);

  if (errors.length) {
    return errors;
  }

  if (question.art !== undefined) {
    errors.push("has both art and a visual; draw the figure once, as a visual");
  }

  if (question.visual.kind === "illustration") {
    const src = question.visual.src;
    const stem = String(question.id).toLowerCase();

    if (src !== `${stem}.webp` && !new RegExp(`^${stem.replace(/[^a-z0-9-]/g, "")}-\\d+\\.webp$`).test(src)) {
      errors.push(`visual (illustration) src must be named after the question: ${stem}.webp or ${stem}-2.webp`);
    }

    errors.push(...checkImageFile(src, imageDir));
  }

  return errors;
}

module.exports = {
  core,
  KINDS_DIR,
  DEFAULT_IMAGE_DIR,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE,
  inspectWebp,
  validateQuestionVisual,
  toPublic: core.toPublic,
  describe: core.describe,
  kinds: core.list
};
