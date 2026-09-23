import type { RoomRecord, RoomRepository } from '@deal-table/application';
export { ConcurrentRoomUpdateError, DynamoDBRoomRepository, RoomAlreadyExistsError } from './dynamodb-room-repository.ts';

/** Local process only: no cross-process or DynamoDB transaction guarantee. */
export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, RoomRecord>();
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
      if (this.rooms.has(room.roomId)) throw new Error('Room already exists');
      this.rooms.set(room.roomId, structuredClone(room));
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
}
