import { Id } from '@deal-table/contracts';
import type {
  KnownEnoughRecord, KnownEnoughRepository, RoomRecord, RoomRepository,
} from '@deal-table/application';
export { DynamoDBRoomRepository, RepositoryStorageError, createAwsDynamoDBRoomRepository } from './dynamodb.ts';
export type { DynamoDBRoomRepositoryOptions } from './dynamodb.ts';

/** Local process only: no cross-process or DynamoDB transaction guarantee. */
export class InMemoryRoomRepository implements RoomRepository, KnownEnoughRepository {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly decisions = new Map<string, KnownEnoughRecord>();
  private readonly tails = new Map<string, Promise<void>>();

  private async isolated<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(roomId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.tails.set(roomId, current);
    await previous;
    try { return await work(); }
    finally {
      release();
      if (this.tails.get(roomId) === current) this.tails.delete(roomId);
    }
  }

  async create(room: RoomRecord): Promise<void> {
    await this.isolated(room.roomId, async () => {
      if (this.rooms.has(room.roomId) || this.decisions.has(room.roomId)) throw new Error('Room already exists');
      this.rooms.set(room.roomId, structuredClone(room));
    });
  }

  async createDecision(decision: KnownEnoughRecord): Promise<void> {
    await this.isolated(decision.decisionId, async () => {
      if (this.rooms.has(decision.decisionId) || this.decisions.has(decision.decisionId))
        throw new Error('Decision already exists');
      this.decisions.set(decision.decisionId, structuredClone(decision));
    });
  }

  async transaction<T>(roomId: string, transition: (room: RoomRecord | null) => Promise<T> | T): Promise<T> {
    return this.isolated(roomId, async () => {
      const stored = this.rooms.get(roomId);
      const working = stored ? structuredClone(stored) : null;
      const result = await transition(working);
      if (working) this.rooms.set(roomId, structuredClone(working));
      return structuredClone(result);
    });
  }

  async transactionDecision<T>(
    decisionId: string,
    transition: (decision: KnownEnoughRecord | null) => Promise<T> | T,
  ): Promise<T> {
    if (!Id.safeParse(decisionId).success) return structuredClone(await transition(null));
    return this.isolated(decisionId, async () => {
      const stored = this.decisions.get(decisionId);
      const working = stored ? structuredClone(stored) : null;
      const result = await transition(working);
      if (working) this.decisions.set(decisionId, structuredClone(working));
      return structuredClone(result);
    });
  }
}

export { BoundedModelJobs, ModelRuntimeError } from './model-jobs.ts';
export type { ModelJobEnvelope, ModelJobMetric } from './model-jobs.ts';
export { BEDROCK_CONFIGURATION, createAuthorizedBedrockTransport, createBedrockModels } from './bedrock-models.ts';
export type { ConverseTransport, ModelUsage } from './bedrock-models.ts';

export { createDynamoGroupRepository, createGroupRepositoryTransport, MemoryGroupRepository, type GroupRepository } from './group-repository.ts';

export { genericCandidates } from './generic-candidates.ts';
