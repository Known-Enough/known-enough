import type { ConverseTransport } from '@deal-table/adapters';
import { npTransport } from './np-model.ts';
/** Synthetic clarification regression provider; never imported by production source. */
export function clarificationTransport(): ConverseTransport {
  const provider = npTransport();
  return { send: async (command, options) => {
    const result = await provider.send(command, options);
    if (command.input.toolConfig?.tools?.[0]?.toolSpec?.name !== 'ke_architect_output') return result;
    const input = JSON.parse(command.input.messages![0]!.content![0]!.text!) as { objective: string };
    const tool = result.output!.message!.content![0]!.toolUse!;
    tool.input = { ...(tool.input as object), clarificationQuestions: input.objective.includes('Public clarification answers:') ? [] : ['Should this meetup be indoors or outdoors?'] };
    return result;
  } };
}
