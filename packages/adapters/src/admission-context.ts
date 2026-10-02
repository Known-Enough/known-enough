import { AsyncLocalStorage } from 'node:async_hooks';
import type { TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { KnownEnoughApplicationError } from '@deal-table/application';
/** Server-only request authority. Never accepted from HTTP input or serialized publicly. */
export interface DecisionAdmissionFence {
  assertCurrent(): Promise<void>;
  serialize<T>(work: () => Promise<T>): Promise<T>;
  write?: TransactWriteItem;
}
const scope = new AsyncLocalStorage<Map<string, DecisionAdmissionFence>>();
export const admissionChanged = (): never => { throw new KnownEnoughApplicationError('STALE_CONTEXT'); };
export function withAdmissionContext<T>(work: () => T): T { return scope.run(new Map(), work); }
export function bindAdmissionFence(decisionId: string, fence: DecisionAdmissionFence): void {
  scope.getStore()?.set(decisionId, fence);
}
export const currentAdmissionFence = (decisionId: string) => scope.getStore()?.get(decisionId);
export function withAdmissionFence<T>(decisionId: string, fence: DecisionAdmissionFence, work: () => T): T {
  const context = new Map(scope.getStore()); context.set(decisionId, fence);
  return scope.run(context, work);
}
