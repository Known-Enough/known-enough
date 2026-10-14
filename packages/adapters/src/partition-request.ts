/** Inactive server-only request entry. Exporting it does not select or activate storage. */
export { createPartitionGroupSession, PartitionSessionError, PartitionDraftFailure, PartitionRegistrationConflict } from './partition-group-session.ts';
export type { PartitionGroupDiscovery, PartitionDraftArchitect, PartitionDraftScope } from './partition-group-session.ts';
export { createPartitionDecisionRepository, PARTITION_DECISION_TARGET } from './partition-decision-repository.ts';
export type { PartitionDecisionTransport } from './partition-decision-repository.ts';
export type { PartitionTransport, PartitionFence, PartitionIOContext, PartitionMutation } from './partitioned-group-repository.ts';
export { partitionIO } from './partitioned-group-repository.ts';
export { createPartitionManagedDriver } from './partition-managed.ts';
export type { PartitionManagedOptions, PartitionManagedArchiveOptions } from './partition-managed.ts';

export type { PublicDraftAtomicItem } from './public-draft-ports.ts';

export { sharedTestEmailHashes } from './partition-directory.ts';
