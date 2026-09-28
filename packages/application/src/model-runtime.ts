import type { TrustedPrincipal } from './types.ts';

export type ModelJobKind = 'ARCHITECT' | 'OWNER' | 'NEGOTIATION';
/** Server-created capability; never serialized into a queue message or model prompt. */
export interface ModelInvocation {
  expiresAt: number;
  assertCurrent(): Promise<void>;
  signal?: AbortSignal;
}
/** Checked inside the same transaction that applies the model's output. */
export interface ModelCommitGuard {
  principal: TrustedPrincipal | null;
  controlVersion: number;
  expiresAt: number;
}
export interface ModelJobRunner {
  run(kind: ModelJobKind, invocation: ModelInvocation, task: (signal: AbortSignal) => Promise<unknown>): Promise<unknown>;
}
