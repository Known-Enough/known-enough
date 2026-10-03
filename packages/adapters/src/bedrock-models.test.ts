import { response, syntheticResponse } from '../../../tests/evaluations/ke10-injected.ts';
import { describe, expect, it, vi } from 'vitest';
import type { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { DecisionNegotiationModelInput, ModelInvocation } from '@deal-table/application';
import type { KnownEnough as KE } from '@deal-table/contracts';
import { BoundedModelJobs } from './model-jobs.ts';
import { createAuthorizedBedrockTransport, createBedrockModels } from './bedrock-models.ts';
import { Ke10EvaluationFailure, runKe10Evaluations, evaluationCanary } from '../../../tests/evaluations/ke10.ts';

const guard = (): ModelInvocation => ({ expiresAt: Date.now() + 30_000, assertCurrent: async () => {} });
const architectInput = { objective: 'choose', participants: [{ id: 'maya', displayName: 'Maya' }], allowedOptions: ['A'] };
const publicVariables: KE.PublicDecisionVariable[] = [
  { id: 'choice', type: 'ENUM', label: 'Choice', required: true, visibility: 'PUBLIC', options: [{ id: 'option-a', label: 'A' }] },
  { id: 'cost', type: 'MONEY', label: 'Cost', required: true, visibility: 'PUBLIC', currencyCode: 'USD', minorUnit: 2 },
];

describe('Bedrock role adapters', () => {
  it('sends structured public scope and copies exact definitions only after all declared IDs are selected', async () => {
    let received: ConverseCommand | undefined;
    const models = createBedrockModels({ transport: { send: async command => {
      received = command;
      return response({ title: 'Draft', description: 'Public scope only', variableIds: ['cost', 'choice'], rules: [],
        clarificationQuestions: [], participantInformationRequirements: [] });
    } }, jobs: new BoundedModelJobs(), enabled: () => true });
    const result = await models.architect.draft({ ...architectInput, publicVariables }, guard());
    const payload = JSON.parse(received!.input.messages![0]!.content![0]!.text!);
    expect(payload.publicVariables).toEqual(publicVariables);
    const prompt = received!.input.system!.map(part => part.text).join('\n');
    expect(prompt).toContain('Use short lowercase IDs matching /^[A-Za-z0-9_-]{1,80}$/ for variables, options and rules; variable IDs and rule IDs must be unique in their lists');
    expect(prompt).toContain('Every variable, option, participant and rule reference');
    expect(prompt).toContain('NUMBER unitCode and scale; MONEY currencyCode and minorUnit');
    expect(prompt).toContain('Use only the fields required by the selected rule operator');
    const tool = received!.input.toolConfig!.tools![0]!.toolSpec!.inputSchema!.json as {
      properties: Record<string, unknown>; required: string[];
    };
    expect(tool.properties.variables).toBeUndefined();
    expect(tool.properties.variableIds).toEqual({ type: 'array', minItems: 2, maxItems: 2,
      items: { type: 'string', enum: ['choice', 'cost'] } });
    expect(tool.required).toContain('variableIds');
    expect(tool.required.every(field => Object.hasOwn(tool.properties, field))).toBe(true);
    expect(result).toEqual({ title: 'Draft', description: 'Public scope only',
      variables: publicVariables.map(variable => ({ ...variable, ownerParticipantId: null })),
      rules: [], clarificationQuestions: [], participantInformationRequirements: [] });
  });
  it.each([{ variableIds: ['choice'] }, { variableIds: ['choice', 'choice'] },
    { variableIds: ['choice', 'guessed-cost'] }, { variableIds: ['choice', 'cost', 'extra'] }])(
    'rejects an incomplete, repeated or undeclared selector $variableIds without repair or retry', async ({ variableIds }) => {
      const diagnostic = vi.fn();
      const send = vi.fn(async () => response({ title: 'Draft', variableIds, description: 'SECRET_OUTPUT', rules: [],
        clarificationQuestions: [], participantInformationRequirements: [] }));
      const models = createBedrockModels({ transport: { send }, jobs: new BoundedModelJobs(), enabled: () => true, diagnostic });
      await expect(models.architect.draft({ ...architectInput, publicVariables }, guard())).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
      expect(send).toHaveBeenCalledTimes(1);
      expect(diagnostic.mock.calls).toEqual([[{ kind: 'ARCHITECT', stage: 'TOOL_OUTPUT' }]]);
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('SECRET');
    });
  it('rejects private/extra schema fields and duplicates before transmitting, even through a direct role call', async () => {
    const send = vi.fn(async () => response({}));
    const models = createBedrockModels({ transport: { send }, jobs: new BoundedModelJobs(), enabled: () => true });
    for (const invalid of [[], [publicVariables[0]!, publicVariables[0]!],
      [{ ...publicVariables[1]!, privateBudget: 'PRIVATE_SCHEMA_CANARY' }],
      [{ ...publicVariables[1]!, visibility: 'OWNER_PRIVATE', ownerParticipantId: 'maya' }]]) {
      await expect(Promise.resolve().then(() => models.architect.draft({ ...architectInput,
        publicVariables: invalid as KE.PublicDecisionVariable[] }, guard()))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(send).not.toHaveBeenCalled();
  });
  it.each(['provider', 'envelope'] as const)('reports a static %s stage without private error/output text; broken diagnostics do not retry', async failure => {
    const events: unknown[] = [];
    const send = vi.fn(async () => {
      if (failure === 'provider') throw Error('Bearer PRIVATE_ERROR');
      return { ...response({ privateBudget: 'PRIVATE_OUTPUT' }), stopReason: 'max_tokens' as const };
    });
    const models = createBedrockModels({ transport: { send }, jobs: new BoundedModelJobs(), enabled: () => true,
      diagnostic: event => { events.push(event); throw Error('PRIVATE_OBSERVER_ERROR'); } });
    await expect(models.architect.draft(architectInput, guard())).rejects.toMatchObject({
      code: failure === 'provider' ? 'PROVIDER_FAILED' : 'INVALID_OUTPUT',
    });
    expect(events).toEqual([{ kind: 'ARCHITECT', stage: failure === 'provider' ? 'PROVIDER' : 'TOOL_ENVELOPE' }]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('accepts catalog selection with a tool schema whose required fields are declared and present in the response', async () => {
    const result = await runKe10Evaluations({ send: async command => {
      const tool = command.input.toolConfig?.tools?.[0]?.toolSpec;
      const schema = tool?.inputSchema?.json as { properties: Record<string, unknown>; required: string[] };
      const output = syntheticResponse(command);
      const value = output.output?.message?.content?.[0]?.toolUse?.input as Record<string, unknown>;
      // Model a provider enforcing the forced output envelope before the role adapter sees it.
      for (const field of schema.required) {
        if (!Object.hasOwn(schema.properties, field) || !Object.hasOwn(value, field))
          throw new Error('INVALID_FORCED_TOOL_SCHEMA');
      }
      return output;
    } });
    expect(result.passed).toEqual(['construction', 'proposal-kernel', 'extraction-without-consent', 'privacy']);
  });
  it('runs the reusable construction, extraction, proposal and privacy evaluations with isolated requests', async () => {
    const requests: ConverseCommand[] = [];
    const result = await runKe10Evaluations({ send: async command => { requests.push(command); return syntheticResponse(command); } });
    expect(result.passed).toEqual(['construction', 'proposal-kernel', 'extraction-without-consent', 'privacy']);
    expect(requests).toHaveLength(3);
    expect(result.usage).toHaveLength(3);
    for (const request of requests) {
      expect(Object.keys(request.input).sort()).toEqual(['inferenceConfig', 'messages', 'modelId', 'system', 'toolConfig']);
      expect(request.input.messages).toHaveLength(1);
      expect(request.input.inferenceConfig).toEqual({ maxTokens: 2_048, temperature: 0 });
      const tool = request.input.toolConfig?.tools?.[0]?.toolSpec;
      expect(tool?.name).toMatch(/^ke_(architect|negotiation|owner)_output$/);
      expect(request.input.toolConfig?.toolChoice).toEqual({ tool: { name: tool?.name } });
      expect(tool?.inputSchema).toMatchObject({ json: { type: 'object', properties: expect.any(Object), required: expect.any(Array) } });
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
      if (mode === 'tool') return response({}, 'unrelated_tool');
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
  it('reports only a safe evaluation stage and failure code', async () => {
    const send = async (command: ConverseCommand) => response({}, command.input.toolConfig?.tools?.[0]?.toolSpec?.name);
    await expect(runKe10Evaluations({ send })).rejects.toMatchObject({
      name: 'Ke10EvaluationFailure', stage: 'construction', failureCode: 'RETRYABLE_SERVER_ERROR',
      message: 'KE10_EVALUATION_FAILED',
    } satisfies Partial<Ke10EvaluationFailure>);
  });
  it('reports an allowlisted negotiation rejection reason without model content', async () => {
    let negotiationCalls = 0;
    const send = async (command: ConverseCommand) => {
      const name = command.input.toolConfig?.tools?.[0]?.toolSpec?.name;
      if (name === 'ke_negotiation_output') {
        negotiationCalls += 1;
        return response({ values: [], permissionDependencies: [], questionIntents: [{ privateText: 'must not escape' }] }, name);
      }
      return syntheticResponse(command);
    };
    await expect(runKe10Evaluations({ send })).rejects.toMatchObject({
      name: 'Ke10EvaluationFailure', stage: 'proposal-kernel', failureCode: 'INVALID_MODEL_OUTPUT',
      diagnosticReason: 'QUESTION_INTENTS', message: 'KE10_EVALUATION_FAILED',
    } satisfies Partial<Ke10EvaluationFailure>);
    expect(negotiationCalls).toBe(2);
  });
  it('converts flat Nova output into a trusted-backend enum question rule', async () => {
    const catalogEntry = [{ variableId: 'destination', value: { type: 'ENUM', optionId: 'mazatlan' } }];
    const models = createBedrockModels({ transport: { send: async () => response({ candidateIndex: 0, permissionDependencies: [], questionIntents: [{
      ownerParticipantId: 'owner-1', constraintId: 'constraint-1', constraintVersion: 1,
      adjustmentVariableId: 'destination', adjustmentOptionIds: ['mazatlan'],
    }] }, 'ke_negotiation_output') }, jobs: new BoundedModelJobs(), enabled: () => true });
    const input = {
      context: { publicSnapshot: { frame: {} }, definition: { decisionId: 'decision-1', variables: [], rules: [] },
        confirmedConstraints: [], activeNegotiationPermissions: [] },
      publicCandidates: [catalogEntry], attempt: 1, retryReason: null, signal: new AbortController().signal, invocation: guard(),
    } as unknown as DecisionNegotiationModelInput;
    const result = await models.negotiation(input) as { values: unknown; questionIntents: { adjustment: unknown }[] };
    expect(result.values).toEqual(catalogEntry);
    expect(result.questionIntents[0]?.adjustment).toEqual({ id: 'ke-adjustment-1', visibility: 'TRUSTED_BACKEND',
      operator: 'IN', variableId: 'destination', values: [{ type: 'ENUM', optionId: 'mazatlan' }] });
  });
});
