import { beforeEach, describe, expect, it, vi } from 'vitest';
const ports = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn(), process: vi.fn(), read: vi.fn() }));
vi.mock('@aws-sdk/client-bedrock', () => ({ BedrockClient: class { send = ports.send; }, GetModelInvocationLoggingConfigurationCommand: class {} }));
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), readFileSync: ports.read }));
vi.mock('./durable-model-worker.ts', () => ({ createManagedDurableNegotiationWorker: ports.create }));
import { handler } from '../../../scripts/operations/jobs-runtime-entry.ts';
import { MODEL_JOB_FUNCTION, MODEL_JOB_RULE } from './durable-scheduled-worker.ts';
const event = { source: 'aws.events', 'detail-type': 'Scheduled Event', account: '092954139775', region: 'us-east-1', resources: [MODEL_JOB_RULE], detail: {} };
const context = { invokedFunctionArn: MODEL_JOB_FUNCTION, getRemainingTimeInMillis: () => 180000 };
describe('dedicated installed worker entry', () => {
  beforeEach(() => {
    vi.clearAllMocks(); ports.read.mockReturnValue(Buffer.from(JSON.stringify({ schemaVersion: 1, sourceSha: 'a'.repeat(40) })));
    ports.send.mockResolvedValue({}); ports.create.mockReturnValue({ deliveries: async () => [], process: ports.process });
  });
  it('rejects a caller-selected event before reading logging or constructing a provider worker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { await expect(handler({ ...event, detail: { jobId: 'private' } }, context)).rejects.toThrow('MODEL_JOB_RUN_UNAVAILABLE');
      expect(ports.send).not.toHaveBeenCalled(); expect(ports.create).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
  it('cannot invoke AI when logging is enabled or its read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const config of [{ textDataDeliveryEnabled: true }, { imageDataDeliveryEnabled: true }, { embeddingDataDeliveryEnabled: true }, { videoDataDeliveryEnabled: true }]) {
        ports.send.mockResolvedValue({ loggingConfig: config });
        await expect(handler(event, context)).rejects.toThrow('MODEL_JOB_RUN_UNAVAILABLE');
      }
      ports.send.mockRejectedValue(new Error('PRIVATE_SERVICE_ERROR'));
      await expect(handler(event, context)).rejects.toThrow('MODEL_JOB_RUN_UNAVAILABLE');
      expect(ports.create).not.toHaveBeenCalled(); expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_SERVICE_ERROR');
    } finally { warn.mockRestore(); }
  });
  it('uses only packaged source and rereads actual logging for every invocation', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await handler(event, context); await handler(event, context);
      expect(ports.send).toHaveBeenCalledTimes(2);
      expect(ports.create.mock.calls[0]?.[0]).toMatchObject({ sourceSha: 'a'.repeat(40), verifiedTarget: { account: '092954139775', region: 'us-east-1' } });
      expect(ports.process).not.toHaveBeenCalled();
      expect(info.mock.calls[0]?.[0]).toContain('"discovered":0');
    } finally { info.mockRestore(); }
  });
  it('corrupt source configuration never reaches the SDK or model', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { ports.read.mockReturnValue(Buffer.from('{"sourceSha":"foreign"}'));
      await expect(handler(event, context)).rejects.toThrow('MODEL_JOB_RUN_UNAVAILABLE');
      expect(ports.send).not.toHaveBeenCalled(); expect(ports.create).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});
