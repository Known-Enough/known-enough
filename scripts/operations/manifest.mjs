import { createHash } from 'node:crypto';
export const MANIFEST_BUCKET = 'known-enough-operations-recovery-092954139775-us-east-1';
const limit = 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function key(hash) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('OPS_MANIFEST_HASH_REJECTED');
  return `manifests/${hash}.json`;
}
function version(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024 || value === 'null') throw new Error('OPS_MANIFEST_VERSION_REQUIRED');
  return value;
}
function verify(bytes, hash) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > limit || digest(bytes) !== hash) throw new Error('OPS_MANIFEST_CONTENT_REJECTED');
  // Format is JSON; its private operation-specific schema is checked by the caller.
  try { JSON.parse(bytes.toString('utf8')); } catch { throw new Error('OPS_MANIFEST_CONTENT_REJECTED'); }
  return bytes;
}
export function manifestStore(transport, bucket) {
  if (bucket !== MANIFEST_BUCKET || typeof transport !== 'function') throw new Error('OPS_MANIFEST_TARGET_REJECTED');
  async function read(hash, versionId) {
    const input = { Bucket: bucket, Key: key(hash), ...(versionId === undefined ? {} : { VersionId: version(versionId) }) };
    let response;
    try { response = await transport('GetObject', input); }
    catch (error) { throw new Error('OPS_MANIFEST_STORAGE_FAILED', { cause: error }); }
    const observedVersion = version(response?.VersionId);
    if (versionId !== undefined && observedVersion !== versionId) throw new Error('OPS_MANIFEST_VERSION_REJECTED');
    // Transport must return bounded bytes, rather than consuming an unbounded body.
    const bytes = verify(response.Body, hash);
    return { bytes: Buffer.from(bytes), versionId: observedVersion };
  }
  return {
    read,
    async preserve(bytes, hash) {
      const input = { Bucket: bucket, Key: key(hash), Body: verify(bytes, hash), IfNoneMatch: '*', ContentType: 'application/json', ServerSideEncryption: 'AES256' };
      let response;
      try { response = await transport('PutObject', input); }
      catch (error) {
        if (error?.name === 'PreconditionFailed') return read(hash);
        throw new Error('OPS_MANIFEST_STORAGE_FAILED', { cause: error });
      }
      const versionId = version(response?.VersionId);
      // Read back the exact immutable version; success response alone is insufficient.
      return read(hash, versionId);
    }
  };
}
