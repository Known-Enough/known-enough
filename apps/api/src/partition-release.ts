import { isDeepStrictEqual } from 'node:util';
import { Groups } from '@deal-table/contracts';
import { loadPartitionMigration } from '@deal-table/adapters/partition-operations';
import { createPartitionDeploymentHandler, type PartitionDeploymentBinding } from './partition-deployment.ts';
import type { HttpApiEvent, HttpApiResult } from './ke13b-lambda.ts';

interface SourceSnapshot { version: number; payload: Buffer }
interface MarkerBinding {
  planHash: string; manifestHash: string; manifestVersion: string; sourceSha: string; sourceRevision: number; sourceHash: string;
}
const invalid = (): never => { throw new Error('PARTITION_RELEASE_INVALID'); };
function unavailable(): HttpApiResult {
  return { statusCode: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '3' },
    body: JSON.stringify({ ok: false, requestId: 'storage-transition', error: { code: 'RETRYABLE_SERVER_ERROR', httpStatus: 503 } }), isBase64Encoded: false };
}
/** State classification is not authentication. Native operations still verify their complete activation tuple. */
export function partitionReleaseMode(source: SourceSnapshot | null, binding: MarkerBinding): 'LEGACY' | 'FROZEN' | 'PARTITION' {
  if (!binding || !/^[a-f0-9]{64}$/.test(binding.planHash) || !/^[a-f0-9]{64}$/.test(binding.manifestHash)
    || !/^[a-f0-9]{64}$/.test(binding.sourceHash) || !/^[a-f0-9]{40}$/.test(binding.sourceSha)
    || typeof binding.manifestVersion !== 'string' || !binding.manifestVersion || binding.manifestVersion === 'null'
    || !Number.isSafeInteger(binding.sourceRevision) || binding.sourceRevision < 1 || binding.sourceRevision > Number.MAX_SAFE_INTEGER - 2) return invalid();
  if (source === null) return 'LEGACY';
  if (!source || !Number.isSafeInteger(source.version) || source.version < 1 || !Buffer.isBuffer(source.payload)
    || source.payload.length < 1 || source.payload.length > 300_000) return invalid();
  let data: unknown; try { data = JSON.parse(source.payload.toString('utf8')); } catch { return invalid(); }
  if (Groups.GroupState.safeParse(data).success) return 'LEGACY';
  for (const phase of ['FROZEN', 'ACTIVE'] as const) {
    const marker = { schemaVersion: 1, kind: 'PARTITION_MIGRATION', phase,
      planHash: binding.planHash, manifestHash: binding.manifestHash, manifestVersion: binding.manifestVersion,
      sourceSha: binding.sourceSha, sourceRevision: binding.sourceRevision, sourceHash: binding.sourceHash,
      account: '092954139775', region: 'us-east-1', table: 'KnownEnoughPartitions' };
    if (isDeepStrictEqual(data, marker) && source.version === binding.sourceRevision + (phase === 'FROZEN' ? 1 : 2))
      return phase === 'FROZEN' ? 'FROZEN' : 'PARTITION';
  }
  return invalid();
}

/** Trusted private candidate construction; no deployment, environment selector or caller-selected identity. */
export function createPartitionReleaseHandler(options: {
  configurationBytes: Buffer; manifestBytes: Buffer; release: PartitionDeploymentBinding;
  legacy: (event: HttpApiEvent) => Promise<HttpApiResult>;
  readSource: (signal: AbortSignal) => Promise<SourceSnapshot | null>;
  diagnostic?: (code: 'SOURCE_UNAVAILABLE' | 'SOURCE_FROZEN') => void;
}): (event: HttpApiEvent) => Promise<HttpApiResult> {
  if (!options || typeof options.legacy !== 'function' || typeof options.readSource !== 'function'
    || (options.diagnostic !== undefined && typeof options.diagnostic !== 'function')) return invalid();
  const config = Buffer.from(options.configurationBytes); const manifest = Buffer.from(options.manifestBytes);
  const release = structuredClone(options.release);
  const native = createPartitionDeploymentHandler(config, manifest, release);
  const plan = loadPartitionMigration(manifest, { sourceSha: release.sourceSha, sourceRevision: release.sourceRevision,
    sourceHash: release.sourceHash, manifestHash: release.manifestHash });
  const binding: MarkerBinding = { planHash: plan.planHash, manifestHash: release.manifestHash,
    manifestVersion: release.manifestVersion, sourceSha: release.sourceSha, sourceRevision: release.sourceRevision, sourceHash: release.sourceHash };
  const legacy = options.legacy; const readSource = options.readSource;
  const diagnostic = options.diagnostic ?? (code => console.warn(JSON.stringify({ event: 'partition-storage-transition', code })));
  const report = (code: 'SOURCE_UNAVAILABLE' | 'SOURCE_FROZEN') => { try { diagnostic(code); } catch { /* Logging never changes selection. */ } };
  return async event => {
    try {
      const signal = AbortSignal.timeout(5000);
      const source = await new Promise<SourceSnapshot | null>((resolve, reject) => {
        const abort = () => reject(new Error('PARTITION_RELEASE_UNAVAILABLE'));
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => readSource(signal)).then(resolve, reject)
          .finally(() => signal.removeEventListener('abort', abort));
      });
      if (signal.aborted) { report('SOURCE_UNAVAILABLE'); return unavailable(); }
      const mode = partitionReleaseMode(source, binding);
      if (mode === 'LEGACY') return await legacy(event);
      if (mode === 'PARTITION') return await native(event);
      report('SOURCE_FROZEN');
    } catch { report('SOURCE_UNAVAILABLE'); }
    return unavailable();
  };
}
