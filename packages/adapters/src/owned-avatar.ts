import { createHash, randomUUID } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { Groups } from '@deal-table/contracts';
const invalid = (): never => { throw new Error('AVATAR_INVALID'); };
function crc(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, bytes: Buffer) {
  const result = Buffer.alloc(bytes.length + 12); result.writeUInt32BE(bytes.length); result.write(kind, 4, 4, 'ascii'); bytes.copy(result, 8);
  result.writeUInt32BE(crc(result.subarray(4, bytes.length + 8)), bytes.length + 8); return result;
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function paeth(a: number, b: number, c: number) { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; }
/** Decode bounded PNG pixels and re-encode without metadata; never stores caller paths or SVG/URLs. */
export function sanitizeOwnedAvatar(encoded: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 21_848) return invalid();
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > 16_384 || bytes.toString('base64') !== encoded || !bytes.subarray(0, 8).equals(signature)) return invalid();
  let offset = 8, header: Buffer | null = null, ended = false, idatEnded = false; const compressed: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (size > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/.test(kind)) return invalid();
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    if (crc(bytes.subarray(offset + 4, offset + 8 + size)) !== bytes.readUInt32BE(offset + 8 + size)) return invalid();
    if (kind === 'IHDR') { if (header || offset !== 8 || size !== 13) return invalid(); header = Buffer.from(data); }
    else if (!header || ended) return invalid();
    else if (kind === 'IDAT') { if (idatEnded) return invalid(); compressed.push(data); }
    else if (kind === 'IEND') { if (size !== 0 || compressed.length === 0) return invalid(); ended = true; }
    else { if (kind[0] === kind[0]?.toUpperCase()) return invalid(); if (compressed.length) idatEnded = true; }
    offset += size + 12;
    if (ended) break;
  }
  if (!header || !ended || offset !== bytes.length) return invalid();
  const width = header.readUInt32BE(), height = header.readUInt32BE(4), channels = header[9] === 2 ? 3 : header[9] === 6 ? 4 : 0;
  if (width < 1 || height < 1 || width > 128 || height > 128 || header[8] !== 8 || !channels || header[10] !== 0 || header[11] !== 0 || header[12] !== 0) return invalid();
  const stride = width * channels, expected = height * (stride + 1); let raw: Buffer;
  try { const result = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected, info: true }) as unknown as { engine: { bytesWritten: number }; buffer: Buffer };
    if (result.engine.bytesWritten !== Buffer.concat(compressed).length) return invalid(); raw = result.buffer;
  } catch { return invalid(); }
  if (raw.length !== expected) return invalid();
  const clean = Buffer.alloc(expected);
  for (let row = 0; row < height; row++) {
    const start = row * (stride + 1), filter = raw[start]!; if (filter > 4) return invalid();
    for (let col = 1; col <= stride; col++) {
      const a = col > channels ? clean[start + col - channels]! : 0, b = row ? clean[start + col - stride - 1]! : 0;
      const c = row && col > channels ? clean[start + col - stride - 1 - channels]! : 0;
      const adjustment = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      clean[start + col] = (raw[start + col]! + adjustment) & 255;
    }
  }
  const normalized = Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(clean)), chunk('IEND', Buffer.alloc(0))]);
  if (normalized.length > 16_384) return invalid();
  return Groups.OwnedAvatar.parse({ id: randomUUID(), mimeType: 'image/png', width, height,
    bytesBase64: normalized.toString('base64'), sha256: createHash('sha256').update(normalized).digest('hex') });
}
