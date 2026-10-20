import { expect, it } from 'vitest';
import { decodeAssistantChatPlan, interpretAssistantChat } from './assistant-chat-model.ts';
import { renderChatPlan, type ChatContext } from '@deal-table/application';

const plan = { focus: 'OUTCOME', optionIndexes: [1, 5, 6, 9], question: 'NONE', answer: 'Untrusted model result' };
it('renders all four current choices and approval facts after discarding irrelevant model selections/prose', () => {
  const output = decodeAssistantChatPlan(plan);
  expect(output).toEqual({ focus: 'OUTCOME', optionIndexes: [], question: 'NONE', answer: '' });
  for (const status of ['PROPOSED', 'AGREED'] as const) {
    const context = { summary: { status, proposalId: 'proposal', approved: status === 'AGREED' ? 15 : 0, requiredApprovals: 15,
      choices: [{ topic: 'Restaurant', option: 'Moon Noodles' }, { topic: 'Date', option: '2026-10-31' },
        { topic: 'Time', option: '18:30' }, { topic: 'Travel', option: 'Bus' }], participants: [] }, options: [], messages: [],
      contextToken: 'a'.repeat(64), publicRevision: 1 } as unknown as ChatContext;
    const text = renderChatPlan(output, context, 'group');
    for (const choice of context.summary.choices) expect(text).toContain(choice.option);
    expect(text).toContain(`${status === 'AGREED' ? 15 : 0} of 15`);
    expect(text).toContain(status === 'AGREED' ? 'The decision is agreed.' : 'not an agreed outcome');
    expect(text).not.toContain(plan.answer);
  }
});
it('keeps option suggestions bounded and rejects malformed/extra model fields', () => {
  expect(decodeAssistantChatPlan({ ...plan, focus: 'OPTIONS' })).toBeNull();
  expect(decodeAssistantChatPlan({ ...plan, optionIndexes: [-1] })).toBeNull();
  expect(decodeAssistantChatPlan({ ...plan, optionIndexes: Array(65).fill(0) })).toBeNull();
  expect(decodeAssistantChatPlan({ ...plan, privateAnswers: 'not permitted' })).toBeNull();
  expect(decodeAssistantChatPlan({ ...plan, focus: 'CONVERSATION', answer: '' })).toBeNull();
});
it('decodes one confirmed tool response without another provider call and preserves its observed usage', async () => {
  let calls = 0;
  const result = await interpretAssistantChat({ send: async command => {
    calls++;
    const schema = command.input.toolConfig!.tools![0]!.toolSpec!.inputSchema!.json as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    return { $metadata: {}, metrics: { latencyMs: 1 }, stopReason: 'tool_use', usage: { inputTokens: 1200, outputTokens: 80, totalTokens: 1280 },
      output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'one', name: 'response_plan', input: plan } }] } } };
  } }, { options: [], messages: [{ role: 'person', text: 'Summarize our agreed plan.' }] } as unknown as ChatContext,
  'group', new AbortController().signal);
  expect(calls).toBe(1); expect(result.output).toMatchObject({ focus: 'OUTCOME', answer: '', optionIndexes: [] });
  expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 80 });
});
