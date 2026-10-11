import { createHash, randomUUID } from 'node:crypto';
import { createPartitionLambdaHandler } from './partition-lambda.ts';
import type { PartitionRuntimeOptions } from './partition-runtime.ts';

/** Independent verified release input; never derive these anchors from HTTP or the manifest itself. */
export interface PartitionDeploymentBinding {
  sourceSha: string;
  configurationHash: string;
  manifestHash: string;
  manifestVersion: string;
  sourceRevision: number;
  sourceHash: string;
}
const bad = (): never => { throw new Error('PARTITION_DEPLOYMENT_INVALID'); };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.getOwnPropertySymbols(value).length
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')
    || keys.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'))) return bad();
  return value as Record<string, unknown>;
}
function bytes(value: Buffer, limit: number): Buffer {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > limit) return bad();
  return Buffer.from(value);
}
function json(value: Buffer): unknown {
  const text = value.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(value)) return bad();
  try { return JSON.parse(text); } catch { return bad(); }
}
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function version(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && value !== 'null'
    && [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
}

/** Private-byte initializer only: no files, environment selector, network or publication.
 * A verified operator packages private inputs and the independent release record.
 * Existing participant composition remains inactive until a separate deployment selects it.
 */
export function createPartitionDeploymentHandler(configurationBytes: Buffer, manifestBytes: Buffer,
  release: PartitionDeploymentBinding, draftArchitect?: PartitionRuntimeOptions['draftArchitect'], lifecycle?: PartitionRuntimeOptions['lifecycle']) {
  try {
    const anchor = record(release, ['sourceSha', 'configurationHash', 'manifestHash', 'manifestVersion', 'sourceRevision', 'sourceHash']);
    if (typeof anchor.sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(anchor.sourceSha) || /^0+$/.test(anchor.sourceSha)
      || !hash(anchor.configurationHash) || !hash(anchor.manifestHash) || !hash(anchor.sourceHash)
      || !version(anchor.manifestVersion) || !Number.isSafeInteger(anchor.sourceRevision)
      || (anchor.sourceRevision as number) < 1
      || (draftArchitect !== undefined && typeof draftArchitect !== 'function')) return bad();
    const configBytes = bytes(configurationBytes, 16_384); const manifest = bytes(manifestBytes, 1024 * 1024);
    if (digest(configBytes) !== anchor.configurationHash || digest(manifest) !== anchor.manifestHash) return bad();
    const config = record(json(configBytes), ['schemaVersion', 'account', 'region', 'userPoolId', 'participantClientId',
      'displayClientId', 'cognitoDomain', 'allowedOrigin', 'emailKey', 'cursorKeyBase64']);
    const snapshot = record(json(manifest), ['schemaVersion', 'sourceSha', 'account', 'region', 'sourceTable', 'sourceKey',
      'targetTable', 'sourceRevision', 'sourceHash', 'sourcePayloadBase64']);
    const sourceKey = record(snapshot.sourceKey, ['PK', 'SK']);
    if (config.schemaVersion !== 1 || config.account !== '092954139775' || config.region !== 'us-east-1'
      || snapshot.schemaVersion !== 2 || snapshot.account !== config.account || snapshot.region !== config.region
      || snapshot.sourceTable !== 'KnownEnoughGroupsStage' || snapshot.targetTable !== 'KnownEnoughPartitions'
      || sourceKey.PK !== 'NP#GROUPS' || sourceKey.SK !== 'STATE'
      || snapshot.sourceSha !== anchor.sourceSha || snapshot.sourceRevision !== anchor.sourceRevision
      || snapshot.sourceHash !== anchor.sourceHash || typeof snapshot.sourcePayloadBase64 !== 'string') return bad();
    const payload = Buffer.from(snapshot.sourcePayloadBase64, 'base64');
    if (payload.length === 0 || payload.length > 300_000 || payload.toString('base64') !== snapshot.sourcePayloadBase64
      || digest(payload) !== anchor.sourceHash) return bad();
    if (typeof config.userPoolId !== 'string' || !/^us-east-1_[A-Za-z0-9]+$/.test(config.userPoolId)
      || ![config.participantClientId, config.displayClientId].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v))
      || config.participantClientId === config.displayClientId || typeof config.cognitoDomain !== 'string'
      || typeof config.allowedOrigin !== 'string' || typeof config.emailKey !== 'string'
      || config.emailKey.length < 32 || config.emailKey.length > 1024 || typeof config.cursorKeyBase64 !== 'string') return bad();
    const domain = URL.parse(config.cognitoDomain); const origin = URL.parse(config.allowedOrigin);
    if (!domain || domain.protocol !== 'https:' || domain.origin !== config.cognitoDomain || domain.username || domain.password || domain.port
      || !/^[a-z0-9-]+\.auth\.us-east-1\.amazoncognito\.com$/.test(domain.hostname)
      || !origin || origin.protocol !== 'https:' || origin.origin !== config.allowedOrigin || origin.username || origin.password) return bad();
    const cursorKey = Buffer.from(config.cursorKeyBase64, 'base64');
    if (cursorKey.length !== 32 || cursorKey.toString('base64') !== config.cursorKeyBase64) return bad();
    const options: PartitionRuntimeOptions = { mode: 'PARTITION_V2',
      managed: { manifestBytes: manifest, expected: { sourceSha: anchor.sourceSha,
        sourceRevision: anchor.sourceRevision as number, sourceHash: anchor.sourceHash, manifestHash: anchor.manifestHash },
        manifestVersion: anchor.manifestVersion, verifiedTarget: { account: '092954139775', region: 'us-east-1' }, cursorKey },
      identity: { userPoolId: config.userPoolId, participantClientId: config.participantClientId as string,
        displayClientId: config.displayClientId as string },
      cognitoDomain: config.cognitoDomain, allowedOrigin: config.allowedOrigin, emailKey: config.emailKey,
      clock: { now: () => new Date().toISOString() }, ids: { next: () => randomUUID() },
      ...(draftArchitect === undefined ? {} : { draftArchitect }),
      ...(lifecycle === undefined ? {} : { lifecycle: { sourceSha: lifecycle.sourceSha, signingKeyBase64: lifecycle.signingKeyBase64 } }) };
    return createPartitionLambdaHandler(options);
  } catch { return bad(); }
}
