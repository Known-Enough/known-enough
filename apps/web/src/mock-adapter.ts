import { PublicRoomSnapshot } from '@deal-table/contracts';
import agreed from './mocks/public/agreed.json';
import blocked from './mocks/public/blocked.json';
import collecting from './mocks/public/collecting.json';
import privateReview from './mocks/public/private-review.json';
import proposed from './mocks/public/proposed.json';
import superseded from './mocks/public/superseded.json';

export type PublicMockScenario = 'collecting' | 'empty' | 'failure' | 'stale' | 'blocked'
  | 'private-review' | 'proposed' | 'agreed' | 'superseded';

export interface MockRead<T> {
  value: T | null;
  freshness: 'fresh' | 'stale';
}

export interface PublicRoomClient {
  getPublicRoom(): Promise<PublicRoomSnapshot>;
  readPublicRoom(scenario?: PublicMockScenario, options?: { refresh?: boolean }): Promise<MockRead<PublicRoomSnapshot>>;
}

const snapshots = { collecting, blocked, 'private-review': privateReview, proposed, agreed, superseded };

const mockLatency = () => new Promise<void>(resolve => globalThis.setTimeout(resolve, 180));

function snapshotFor(scenario: Exclude<PublicMockScenario, 'empty' | 'failure' | 'stale'>): PublicRoomSnapshot {
  return PublicRoomSnapshot.parse(structuredClone(snapshots[scenario]));
}

export const publicMockClient: PublicRoomClient = {
  async getPublicRoom() { return snapshotFor('collecting'); },
  async readPublicRoom(scenario = 'collecting', options = {}) {
    await mockLatency();
    if (scenario === 'failure') throw new Error('Synthetic public mock failure');
    if (scenario === 'empty') return { value: null, freshness: 'fresh' };
    if (scenario === 'stale') return { value: snapshotFor('collecting'), freshness: options.refresh ? 'fresh' : 'stale' };
    return { value: snapshotFor(scenario), freshness: 'fresh' };
  },
};
