import { expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { sanitizeOwnedAvatar } from './owned-avatar.ts';
function crc(bytes: Buffer) { let x = 0xffffffff; for (const b of bytes) { x ^= b; for (let i = 0; i < 8; i++) x = (x >>> 1) ^ ((x & 1) ? 0xedb88320 : 0); } return (x ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, data.length + 8)), data.length + 8); return out; }
export function avatarPng(options: { width?: number; metadata?: boolean; raw?: Buffer } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(options.width ?? 1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    ...(options.metadata ? [chunk('tEXt', Buffer.from('PRIVATE_METADATA_CANARY'))] : []),
    chunk('IDAT', deflateSync(options.raw ?? Buffer.from([0, 22, 55, 77, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
it('decodes actual pixels, strips metadata and generates server identities', () => {
  const bytes = avatarPng({ metadata: true }); const first = sanitizeOwnedAvatar(bytes.toString('base64'));
  const second = sanitizeOwnedAvatar(bytes.toString('base64'));
  expect(Buffer.from(first.bytesBase64, 'base64').includes(Buffer.from('PRIVATE_METADATA_CANARY'))).toBe(false);
  expect(first).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 });
  expect(first.id).not.toBe(second.id); expect(first.sha256).toBe(second.sha256);
});
it('rejects executable formats, corrupt pixels, oversize dimensions, CRC changes and trailing payloads', () => {
  const damaged = avatarPng(); damaged[25] = 99;
  for (const bytes of [Buffer.from('<svg onload="alert(1)"></svg>'), damaged, avatarPng({ width: 129 }),
    avatarPng({ raw: Buffer.from([5, 0, 0, 0, 0]) }), avatarPng({ raw: Buffer.alloc(100000) }),
    Buffer.concat([avatarPng(), Buffer.from('TRAILING_PRIVATE_PAYLOAD')])]) {
    expect(() => sanitizeOwnedAvatar(bytes.toString('base64'))).toThrow('AVATAR_INVALID');
  }
});
