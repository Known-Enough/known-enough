import { useState } from 'react';
import type { InputValues, Interval, PublicRoomSnapshot } from '@deal-table/contracts';

export const describeInterval = (value: Interval) => {
  const time = (minute: number) => `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
  return `${value.date} · ${time(value.startMinute)}–${time(value.endMinute)} · ${value.timezone}`;
};

// The public schedule supplies questions only. Each answer starts unselected.
export function InitialInputForm({ room, disabled, submit }: {
  room: PublicRoomSnapshot; disabled: boolean; submit: (values: InputValues) => void;
}) {
  const options = [...room.schedule.slots.map(slot => ({ id: slot.id, label: 'Meeting', interval: slot.interval })), ...room.schedule.duties];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const complete = options.every(option => answers[option.id]) && room.schedule.duties.every(duty => costs[duty.id] !== undefined);
  const values = (): InputValues => {
    const allowed = options.filter(option => answers[option.id] !== 'unavailable').map(option => option.interval);
    return {
      conditions: [
        ...(allowed.length ? [{ id: 'owner-availability', kind: 'HARD_AVAILABILITY' as const, availableIntervals: allowed }] : []),
        ...options.filter(option => answers[option.id] !== 'available').map(option => ({
          id: `owner-${option.id}`, kind: 'NEGOTIABLE_UNAVAILABLE' as const, interval: option.interval,
          inviteException: answers[option.id] === 'exception',
        })),
      ],
      dutyCosts: room.schedule.duties.map(duty => ({ dutyId: duty.id, cost: Number(costs[duty.id]) })),
    };
  };
  return <fieldset disabled={disabled}>
    <legend>Assess each exact interval</legend>
    {options.map(option => <label key={option.id}>{option.label} · {describeInterval(option.interval)}
      <select value={answers[option.id] ?? ''} onChange={event => setAnswers(current => ({ ...current, [option.id]: event.target.value }))}>
        <option value="">Choose availability</option>
        <option value="available">Available</option>
        <option value="unavailable">Unavailable; do not ask for an exception</option>
        <option value="exception">Unavailable; you may ask about a scoped exception</option>
      </select>
    </label>)}
    {room.schedule.duties.map(duty => <label key={duty.id}>{duty.label} cost
      <select value={costs[duty.id] ?? ''} onChange={event => setCosts(current => ({ ...current, [duty.id]: event.target.value }))}>
        <option value="">Choose cost</option>
        {[0, 1, 2, 3].map(cost => <option key={cost} value={cost}>{cost}</option>)}
      </select>
    </label>)}
    <button type="button" disabled={!complete} onClick={() => submit(values())}>Submit input draft</button>
  </fieldset>;
}

export function InputSummary({ values, room }: { values: InputValues; room: PublicRoomSnapshot }) {
  return <div>
    <ul>{values.conditions.map(condition => <li key={condition.id}>{condition.kind === 'HARD_AVAILABILITY'
      ? <>Available only within: {condition.availableIntervals.map(describeInterval).join('; ')}. Separate unavailable conditions still apply.</>
      : <>{describeInterval(condition.interval)}: unavailable; {condition.inviteException ? 'you may ask about a scoped exception' : 'do not ask for an exception'}.</>}</li>)}</ul>
    <ul>{values.dutyCosts.map(cost => <li key={cost.dutyId}>{room.schedule.duties.find(duty => duty.id === cost.dutyId)?.label ?? cost.dutyId} cost: {cost.cost}</li>)}</ul>
  </div>;
}
