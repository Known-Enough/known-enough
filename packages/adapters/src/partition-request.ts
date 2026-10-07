/** Inactive server-only request entry. Exporting it does not select or activate storage. */
export { createPartitionGroupSession, PartitionSessionError } from './partition-group-session.ts';
export type { PartitionGroupDiscovery, PartitionDraftArchitect } from './partition-group-session.ts';
export { createPartitionDecisionRepository, PARTITION_DECISION_TARGET } from './partition-decision-repository.ts';
export type { PartitionDecisionTransport } from './partition-decision-repository.ts';
export type { PartitionTransport } from './partitioned-group-repository.ts';
export { partitionIO } from './partitioned-group-repository.ts';
