'use strict';
// =====================================================
// IDauto — IDA-V14 — image sniffing (pure, no dependency)
// reference/documents/image-meta.js
//
// The client's declared Content-Type and filename are never trusted. The
// real type comes from the magic bytes, the dimensions from the headers of
// the three formats the browser pipeline can produce (JPEG, PNG, WebP).
// Anything else — including a valid PNG renamed .jpg — is refused.
// =====================================================

function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function jpegSize(buf) {
  var i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) return null;
    var marker = buf[i + 1];
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) { i += 2; continue; }
    var len = buf.readUInt16BE(i + 2);
    if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xD9 || marker === 0xDA) return null;
    i += 2 + len;
  }
  return null;
}
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
function webpSize(buf) {
  var chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ' && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
  if (chunk === 'VP8L' && buf.length >= 25) { var b = buf.readUInt32LE(21); return { width: (b & 0x3FFF) + 1, height: ((b >> 14) & 0x3FFF) + 1 }; }
  if (chunk === 'VP8X' && buf.length >= 30) return { width: (buf.readUIntLE(24, 3)) + 1, height: (buf.readUIntLE(27, 3)) + 1 };
  return null;
}

// → { mime, width, height } or null when the bytes are not a supported image.
function inspect(buf) {
  var mime = sniff(buf);
  if (!mime) return null;
  var size = mime === 'image/jpeg' ? jpegSize(buf) : mime === 'image/png' ? pngSize(buf) : webpSize(buf);
  if (!size || !(size.width > 0) || !(size.height > 0)) return null;
  return { mime: mime, width: size.width, height: size.height };
}

module.exports = { sniff: sniff, inspect: inspect };
