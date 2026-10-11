import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { preparePartitionMigration } from '@deal-table/adapters/partition-operations';
import { createPartitionReleaseHandler, partitionReleaseMode } from './partition-release.ts';
import type { HttpApiEvent } from './ke13b-lambda.ts';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const source = encode({ accounts: [], groups: [] });
  const prepared = preparePartitionMigration(source, 3, 'a'.repeat(40));
  const config = encode({ schemaVersion: 1, account: '092954139775', region: 'us-east-1', userPoolId: 'us-east-1_synthetic',
    participantClientId: 'participant', displayClientId: 'display', cognitoDomain: 'https://synthetic.auth.us-east-1.amazoncognito.com',
    allowedOrigin: 'https://known.example.invalid', emailKey: 'PRIVATE_EMAIL_KEY'.repeat(3), cursorKeyBase64: Buffer.alloc(32, 7).toString('base64') });
  const release = { sourceSha: 'a'.repeat(40), configurationHash: hash(config), manifestHash: prepared.manifestHash,
    manifestVersion: 'immutable-version', sourceHash: prepared.sourceHash, sourceRevision: 3 };
  const binding = { planHash: prepared.planHash, manifestHash: release.manifestHash, manifestVersion: release.manifestVersion,
    sourceSha: release.sourceSha, sourceRevision: release.sourceRevision, sourceHash: release.sourceHash };
  const marker = (phase: 'FROZEN' | 'ACTIVE') => ({ schemaVersion: 1, kind: 'PARTITION_MIGRATION', phase, ...binding,
    account: '092954139775', region: 'us-east-1', table: 'KnownEnoughPartitions' });
  return { source, config, prepared, release, binding, marker };
}
const event: HttpApiEvent = { version: '2.0', rawPath: '/account', rawQueryString: '', headers: { origin: 'https://known.example.invalid' },
  requestContext: { http: { method: 'OPTIONS' } } };
afterEach(() => { vi.useRealTimers(); });

it('legacy absence and legitimate legacy state changes do not stop the standby handler', () => {
  const f = fixture(); expect(partitionReleaseMode(null, f.binding)).toBe('LEGACY');
  expect(partitionReleaseMode({ version: 3, payload: f.source }, f.binding)).toBe('LEGACY');
  expect(partitionReleaseMode({ version: 9, payload: encode({ accounts: [], groups: [] }) }, f.binding)).toBe('LEGACY');
});
it('exact frozen marker blocks traffic; exact active marker selects native composition', () => {
  const f = fixture(); expect(partitionReleaseMode({ version: 4, payload: encode(f.marker('FROZEN')) }, f.binding)).toBe('FROZEN');
  expect(partitionReleaseMode({ version: 5, payload: encode(f.marker('ACTIVE')) }, f.binding)).toBe('PARTITION');
});
it.each(['version', 'planHash', 'manifestVersion', 'sourceHash', 'sourceSha', 'account', 'region', 'table', 'extra'])('unknown or changed %s cannot fall back to legacy', field => {
  const f = fixture(); const marker: Record<string, unknown> = f.marker('ACTIVE');
  if (field !== 'version') marker[field] = 'PRIVATE_FOREIGN';
  expect(() => partitionReleaseMode({ version: field === 'version' ? 6 : 5, payload: encode(marker) }, f.binding)).toThrow('PARTITION_RELEASE_INVALID');
});
it('uses actual native OPTIONS/CORS after activation and ignores request-selected storage while in standby', async () => {
  const f = fixture(); let source = { version: 3, payload: f.source }; const legacy = vi.fn(async () => ({ statusCode: 202, headers: {}, body: 'legacy', isBase64Encoded: false as const }));
  const handler = createPartitionReleaseHandler({ configurationBytes: f.config, manifestBytes: f.prepared.manifestBytes, release: f.release,
    legacy, readSource: async signal => { expect(signal).toBeInstanceOf(AbortSignal); return source; } });
  expect((await handler({ ...event, headers: { 'x-storage-mode': 'PARTITION' }, body: '{"activate":true}' })).statusCode).toBe(202);
  source = { version: 4, payload: encode(f.marker('FROZEN')) }; expect((await handler(event)).statusCode).toBe(503);
  source = { version: 5, payload: encode(f.marker('ACTIVE')) }; const result = await handler(event);
  expect(result.statusCode).toBe(204); expect(result.headers?.['access-control-allow-origin']).toBe('https://known.example.invalid');
  expect(legacy).toHaveBeenCalledTimes(1);
});
it('provider failure cannot expose private source details or invoke either data handler', async () => {
  const f = fixture(); const legacy = vi.fn(); const diagnostic = vi.fn();
  const handler = createPartitionReleaseHandler({ configurationBytes: f.config, manifestBytes: f.prepared.manifestBytes, release: f.release,
    legacy, diagnostic, readSource: async () => { throw new Error('PRIVATE_SOURCE_CANARY'); } });
  const result = await handler(event); expect(result.statusCode).toBe(503); expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(legacy).not.toHaveBeenCalled();
  expect(diagnostic).toHaveBeenCalledExactlyOnceWith('SOURCE_UNAVAILABLE');
});
