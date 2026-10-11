export interface JobsPackage { schemaVersion: 1; sourceSha: string }
const invalid = (): never => { throw new Error('JOBS_PACKAGE_INVALID'); };
/** Only verified private deployment bytes can select the queued request runtime. */
export function loadJobsPackage(bytes: Buffer): JobsPackage {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 256) return invalid();
    const value: unknown = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('|') !== 'schemaVersion|sourceSha') return invalid();
    const record = value as JobsPackage;
    if (record.schemaVersion !== 1 || typeof record.sourceSha !== 'string'
      || !/^[a-f0-9]{40}$/.test(record.sourceSha) || /^0+$/.test(record.sourceSha)) return invalid();
    return { schemaVersion: 1, sourceSha: record.sourceSha };
  } catch { return invalid(); }
}
