import { InputValues, type InputValues as InputValuesType, type PublicRoomSnapshot } from '@deal-table/contracts';

export const HOST_LANGUAGE_SAMPLE = 'I am available only for the meeting on 2026-10-08 from 11:00 to 11:30 in America/Mexico_City.';

/** UI boundary for a future extraction service. The response is untrusted until parsed as InputValues. */
export type OwnerDraftExtractor = (text: string, room: PublicRoomSnapshot) => Promise<unknown>;

/** Fixed local demo response; it does not call a model or send the sentence anywhere. */
export const hostSimulationExtractor: OwnerDraftExtractor = async (text, room): Promise<InputValuesType> => {
  await Promise.resolve();
  if (text.trim() !== HOST_LANGUAGE_SAMPLE) throw new Error('No fixture for this sentence');

  const slot = room.schedule.slots.find(item => item.interval.date === '2026-10-08'
    && item.interval.timezone === 'America/Mexico_City' && item.interval.startMinute === 660 && item.interval.endMinute === 690);
  if (!slot) throw new Error('The sample interval is not present');

  return InputValues.parse({
    conditions: [{ id: 'sample-thursday-1100', kind: 'HARD_AVAILABILITY', availableIntervals: [slot.interval] }],
    dutyCosts: [],
  });
};

export function validateOwnerDraftResponse(response: unknown): InputValuesType | null {
  const parsed = InputValues.safeParse(response);
  return parsed.success ? parsed.data : null;
}
