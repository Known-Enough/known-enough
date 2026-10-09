import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { verifySource } from './verify.mjs';
import { setupTemplate, RECOVERY_ROLE } from './setup.mjs';
import { partitionSetupTemplate, PARTITION_RESOURCES } from './partition-setup.mjs';
import { retentionSetupPreparation } from './retention-setup.mjs';
import { jobSetupPreparation } from './jobs-setup.mjs';

const proposals = [
  ['infra/operations/setup.json', setupTemplate],
  ['infra/operations/partition-setup.json', partitionSetupTemplate],
  ['infra/operations/retention-setup.json', retentionSetupPreparation],
  ['infra/operations/jobs-setup.json', jobSetupPreparation],
];
const array = value => Array.isArray(value) ? value : [value];
const hash = value => createHash('sha256').update(value).digest('hex');
const keys = statement => statement.Condition?.['ForAllValues:StringLike']?.['dynamodb:LeadingKeys'];

// This compares declarations, not effective IAM authorization. Conditions remain
// attached to each profile; sharing a table/action never establishes key access.
function comparison(action, resource, condition, baseline) {
  const matching = baseline.filter(statement => statement.Effect === 'Allow'
    && array(statement.Action).includes(action) && array(statement.Resource).includes(resource));
  if (!matching.length) return { result: 'RESOURCE_ACTION_NOT_DECLARED', recoveryConditions: [] };
  const requiredKeys = keys({ Condition: condition });
  const sameKeys = matching.some(statement => JSON.stringify(keys(statement)) === JSON.stringify(requiredKeys));
  return {
    result: sameKeys ? 'RESOURCE_ACTION_REUSE_CANDIDATE' : 'LEADING_KEY_SCOPE_DIFFERS',
    recoveryConditions: matching.map(statement => statement.Condition ?? {}),
  };
}

export function operationCapabilityReport(env, saved) {
  const sourceSha = verifySource(env);
  const checked = proposals.map(([file, generate]) => {
    let bytes;
    try { bytes = saved[file]; } catch { throw new Error('OPS_CAPABILITY_INPUT_REJECTED'); }
    const proposal = generate();
    if (typeof bytes !== 'string' || bytes !== JSON.stringify(proposal, null, 2) + '\n') {
      throw new Error('OPS_CAPABILITY_PROPOSAL_DRIFT');
    }
    return { file, bytes, proposal };
  });
  const recovery = checked[0].proposal.Resources.RecoveryRole.Properties;
  const baseline = recovery.Policies[0].PolicyDocument.Statement;
  const families = [
    ['OPS01', checked[1].proposal.Metadata.PermissionProfiles],
    ['OPS02', checked[2].proposal.permissionProfiles],
    ['OPS03', checked[3].proposal.permissionProfiles],
  ];
  const profiles = families.flatMap(([task, policies]) => Object.entries(policies).map(([profile, policy]) => ({
    task, profile, roleAttachment: 'NOT_VERIFIED',
    statements: policy.Statement.map(statement => ({
      sid: statement.Sid,
      requiredCondition: statement.Condition ?? {},
      operations: array(statement.Resource).flatMap(resource => array(statement.Action).map(action => ({
        action, resource, declarationComparison: comparison(action, resource, statement.Condition, baseline),
        effectivePermission: 'UNKNOWN', managedOperation: 'NOT_EXECUTED',
      }))),
    })),
  })));
  const operations = profiles.flatMap(profile => profile.statements.flatMap(statement => statement.operations));
  if (operations.length > 256) throw new Error('OPS_CAPABILITY_LIMIT_EXCEEDED');
  return {
    schemaVersion: 1, result: 'OFFLINE_REQUIREMENTS_MAPPED', sourceSha,
    target: { account: PARTITION_RESOURCES.account, region: PARTITION_RESOURCES.region },
    proposalHashes: Object.fromEntries(checked.map(({ file, bytes }) => [file, hash(bytes)])),
    basis: 'EXACT_CHECKED_PROPOSAL_DECLARATIONS_ONLY', recoveryRole: RECOVERY_ROLE,
    recoveryDeclarationHash: hash(JSON.stringify(recovery.Policies[0].PolicyDocument)),
    retainedRecoveryDenials: baseline.filter(statement => statement.Effect === 'Deny'),
    retainedManifestPolicy: checked[0].proposal.Resources.ManifestPolicy.Properties.PolicyDocument,
    profiles,
    counts: {
      profiles: profiles.length, operations: operations.length,
      reuseCandidates: operations.filter(op => op.declarationComparison.result === 'RESOURCE_ACTION_REUSE_CANDIDATE').length,
      differentLeadingKeys: operations.filter(op => op.declarationComparison.result === 'LEADING_KEY_SCOPE_DIFFERS').length,
      undeclaredResourceActions: operations.filter(op => op.declarationComparison.result === 'RESOURCE_ACTION_NOT_DECLARED').length,
    },
    resourcePreparation: {
      createOnlyIfVerifiedAbsent: [PARTITION_RESOURCES.target],
      proposedTemplate: 'infra/operations/partition-setup.json',
      retainExisting: [PARTITION_RESOURCES.source, PARTITION_RESOURCES.decisions, PARTITION_RESOURCES.journal,
        `arn:aws:dynamodb:${PARTITION_RESOURCES.region}:${PARTITION_RESOURCES.account}:table/KnownEnoughQaControl`,
        checked[0].proposal.Resources.Manifests.Properties.BucketName],
      currentExistence: 'REQUIRES_ACTUAL_READBACK', roleBindings: 'REQUIRES_EFFECTIVE_ROLE_READBACK',
    },
    limits: {
      iamEvaluation: 'NOT_PERFORMED', effectivePermissions: 'UNKNOWN', profileUnion: 'NOT_AUTHORIZED',
      installation: 'NOT_EXECUTED', activation: 'DISABLED', participantConsent: 'NOT_GRANTED',
      dataOperations: 'NOT_EXECUTED', providerCalls: 'NOT_EXECUTED',
      requiredSeparateProof: ['runtime identity and role separation', 'source/control/copied-journal activation',
        'current participant consent and retention provenance', 'managed migration/archive/erasure/job recovery',
        'provider permissions/quiescence and cumulative usage', 'logs/backups/provider retention and cleanup'],
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    verifySource(process.env);
    const saved = Object.fromEntries(proposals.map(([file]) => [file, readFileSync(file, 'utf8')]));
    console.log(JSON.stringify(operationCapabilityReport(process.env, saved), null, 2));
  } catch { console.error('OPS_CAPABILITY_REPORT_FAILED'); process.exitCode = 1; }
}
