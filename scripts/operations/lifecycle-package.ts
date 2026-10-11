import { randomBytes } from 'node:crypto';

export interface LifecyclePackage { schemaVersion: 1; sourceSha: string; signingKeyBase64: string }
const invalid = (): never => { throw new Error('LIFECYCLE_PACKAGE_INVALID'); };
/** Private package input only. No request, environment or public DTO supplies these bytes. */
export function loadLifecyclePackage(bytes: Buffer): LifecyclePackage {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 1024) return invalid();
    const text = new TextDecoder('utf8', { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('|') !== 'schemaVersion|signingKeyBase64|sourceSha') return invalid();
    const record = value as LifecyclePackage;
    if (record.schemaVersion !== 1 || typeof record.sourceSha !== 'string'
      || !/^[a-f0-9]{40}$/.test(record.sourceSha) || /^0+$/.test(record.sourceSha)
      || typeof record.signingKeyBase64 !== 'string') return invalid();
    const key = Buffer.from(record.signingKeyBase64, 'base64');
    if (key.length !== 32 || key.toString('base64') !== record.signingKeyBase64 || key.every(byte => byte === 0)) return invalid();
    return { schemaVersion: 1, sourceSha: record.sourceSha, signingKeyBase64: record.signingKeyBase64 };
  } catch { return invalid(); }
}
export function lifecyclePackageBytes(sourceSha: string, previous?: Buffer): Buffer {
  const key = previous === undefined ? randomBytes(32).toString('base64') : loadLifecyclePackage(previous).signingKeyBase64;
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, sourceSha, signingKeyBase64: key }));
  loadLifecyclePackage(bytes);
  return bytes;
}
