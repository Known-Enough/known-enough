import { response } from '../../../tests/evaluations/ke10-injected.ts';
import { syntheticResponse } from '../../../tests/evaluations/ke10-injected.ts';
import { describe, expect, it, vi } from 'vitest';
import type { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ModelInvocation } from '@deal-table/application';
import { BoundedModelJobs } from './model-jobs.ts';
import { createAuthorizedBedrockTransport, createBedrockModels } from './bedrock-models.ts';
import { runKe10Evaluations, evaluationCanary } from '../../../tests/evaluations/ke10.ts';

const guard = (): ModelInvocation => ({ expiresAt: Date.now() + 30_000, assertCurrent: async () => {} });
const architectInput = { objective: 'choose', participants: [{ id: 'maya', displayName: 'Maya' }], allowedOptions: ['A'] };

describe('Bedrock role adapters', () => {
  it('runs the reusable construction, extraction, proposal and privacy evaluations with isolated requests', async () => {
    const requests: ConverseCommand[] = [];
    const result = await runKe10Evaluations({ send: async command => { requests.push(command); return syntheticResponse(command); } });
    expect(result.passed).toEqual(['construction', 'proposal-kernel', 'extraction-without-consent', 'privacy']);
    expect(requests).toHaveLength(3);
    expect(result.usage).toHaveLength(3);
    for (const request of requests) {
      expect(Object.keys(request.input).sort()).toEqual(['inferenceConfig', 'messages', 'modelId', 'system']);
      expect(request.input.messages).toHaveLength(1);
      expect(request.input.inferenceConfig).toEqual({ maxTokens: 2_048, temperature: 0 });
    }
    expect(JSON.stringify(requests[0]!.input)).not.toContain(evaluationCanary);
    expect(JSON.stringify(requests[2]!.input)).toContain(evaluationCanary);
    expect(JSON.stringify(requests[2]!.input)).not.toContain('nina-destination-flexibility');
    expect(JSON.stringify(requests[1]!.input)).not.toContain(evaluationCanary);
    expect(JSON.stringify(result)).not.toContain(evaluationCanary);
  });
  it.each(['provider', 'json', 'truncated', 'tool', 'oversized', 'array'] as const)('fails closed for %s without echoing private output', async mode => {
    const send = vi.fn(async () => {
      if (mode === 'provider') throw Error('PRIVATE_PROVIDER_ERROR');
      if (mode === 'json') return { ...response({}), output: { message: { role: 'assistant' as const, content: [{ text: 'PRIVATE_INVALID_JSON' }] } } };
      if (mode === 'truncated') return { ...response({}), stopReason: 'max_tokens' as const };
      if (mode === 'tool') return { ...response({}), output: { message: { role: 'assistant' as const,
        content: [{ toolUse: { toolUseId: 'private', name: 'publish', input: {} } }] } } };
      if (mode === 'array') return response([]);
      return response({ text: 'PRIVATE'.repeat(10_000) });
    });
    const models = createBedrockModels({ transport: { send }, jobs: new BoundedModelJobs(), enabled: () => true });
    await expect(models.architect.draft(architectInput, guard())).rejects.toMatchObject({
      message: mode === 'provider' ? 'PROVIDER_FAILED' : 'INVALID_OUTPUT',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('requires authorization, runtime enablement, a server capability and bounded inputs', async () => {
    expect(() => createAuthorizedBedrockTransport({ paidCallsApproved: false, invocationLoggingDisabled: true, retentionReviewed: true }))
      .toThrow('DISABLED');
    const send = vi.fn(async () => response({}));
    let enabled = false;
    const models = createBedrockModels({ transport: { send }, jobs: new BoundedModelJobs(), enabled: () => enabled });
    await expect(models.architect.draft(architectInput, guard())).rejects.toMatchObject({ code: 'DISABLED' });
    enabled = true;
    await expect(models.architect.draft(architectInput)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(models.architect.draft({ ...architectInput, objective: 'x'.repeat(70_000) }, guard()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(send).not.toHaveBeenCalled();
  });
});
