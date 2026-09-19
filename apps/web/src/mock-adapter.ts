import { PublicRoomSnapshot } from '@deal-table/contracts';
import collecting from './mocks/public/collecting.json';

export interface PublicRoomClient {
  getPublicRoom(): Promise<PublicRoomSnapshot>;
}
export const publicMockClient: PublicRoomClient = {
  async getPublicRoom() { return PublicRoomSnapshot.parse(structuredClone(collecting)); },
};
