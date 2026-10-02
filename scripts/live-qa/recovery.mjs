import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mailboxProvider, targetNames } from './config.mjs';

const priorSource = 'e0cd5ddd3ede595eea88aef3481c23bf01363a8a';
const marker = 'RETAINED_QA_TABLES_IMPORTED';
const logicalNames = ['Control', 'Decisions', 'Groups'];
const delay = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms));
const canonical = value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const body = value => typeof value === 'string' ? JSON.parse(value) : value;
const owned = stack => stack?.Tags?.some(tag => tag.Key === 'KnownEnoughQa' && tag.Value === 'true');
const outputs = stack => Object.fromEntries((stack?.Outputs ?? []).map(item => [item.OutputKey, item.OutputValue]));
export const isRecoveryStack = stack => outputs(stack).RecoveryStage === marker;

export function recoveryTemplate(config, template) {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Known Enough recovery: import retained QA tables without changing data',
    Resources: Object.fromEntries(logicalNames.map(name => [name, structuredClone(template.Resources[name])])),
    Outputs: {
      RecoveryStage: { Value: marker }, MailboxProvider: { Value: 'mailtm' },
      SourceCommit: { Value: config.sourceCommit },
      ControlTable: { Value: { Ref: 'Control' } },
      DecisionTable: { Value: { Ref: 'Decisions' } }, GroupTable: { Value: { Ref: 'Groups' } },
    },
  };
}
function describe(aws, name) {
  try { return aws('cloudformation', 'describe-stacks', { StackName: name }).Stacks[0]; }
  catch (error) { if (error.missing) return null; throw error; }
}
function tableNames(config) {
  const names = targetNames(config);
  return { Control: names.control, Decisions: names.decisions, Groups: names.groups };
}
function resources(aws, stack) {
  return aws('cloudformation', 'list-stack-resources', { StackName: stack.StackId }).StackResourceSummaries
    .filter(item => item.ResourceStatus !== 'DELETE_COMPLETE');
}
function assertResources(config, items, retained) {
  const names = tableNames(config);
  if (items.length !== 3 || new Set(items.map(item => item.LogicalResourceId)).size !== 3
    || items.some(item => !logicalNames.includes(item.LogicalResourceId)
      || item.ResourceType !== 'AWS::DynamoDB::Table'
      || item.PhysicalResourceId !== names[item.LogicalResourceId]
      || (retained && item.ResourceStatus !== 'DELETE_SKIPPED'))) throw new Error('RECOVERY_RESOURCE_SCOPE_MISMATCH');
}
export function assertRecoveryStack(config, stack, observedResources, template, expected) {
  if (!owned(stack) || !isRecoveryStack(stack) || stack.StackStatus !== 'IMPORT_COMPLETE'
    || outputs(stack).MailboxProvider !== 'mailtm' || outputs(stack).SourceCommit !== config.sourceCommit
    || canonical(template) !== canonical(recoveryTemplate(config, expected))) throw new Error('RECOVERY_IMPORT_STATE_MISMATCH');
  assertResources(config, observedResources, false);
}
function checkTables(config, aws) {
  for (const name of Object.values(tableNames(config))) {
    const table = aws('dynamodb', 'describe-table', { TableName: name }).Table;
    const expectedArn = `arn:aws:dynamodb:${config.region}:${config.account}:table/${name}`;
    if (table.TableArn !== expectedArn || table.TableStatus !== 'ACTIVE'
      || canonical(table.KeySchema) !== canonical([{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }])
      || canonical([...table.AttributeDefinitions].sort((a, b) => a.AttributeName.localeCompare(b.AttributeName)))
        !== canonical([{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }])
      || table.BillingModeSummary?.BillingMode !== 'PAY_PER_REQUEST'
      || table.GlobalSecondaryIndexes?.length || table.LocalSecondaryIndexes?.length) throw new Error('RECOVERY_TABLE_MISMATCH');
    const tags = aws('dynamodb', 'list-tags-of-resource', { ResourceArn: expectedArn }).Tags;
    if (!tags.some(tag => tag.Key === 'KnownEnoughQa' && tag.Value === 'true')) throw new Error('RECOVERY_TABLE_NOT_OWNED');
  }
  const lease = aws('dynamodb', 'get-item', { TableName: tableNames(config).Control,
    Key: { PK: { S: 'LEASE' }, SK: { S: 'STATE' } }, ConsistentRead: true });
  if (lease.Item && JSON.parse(lease.Item.payload.S).status !== 'CLEAN') throw new Error('RECOVERY_ACTIVE_LEASE_BLOCKED');
}
async function waitStack(aws, name, expected, pause) {
  for (let i = 0; i < 180; i++) {
    const stack = describe(aws, name);
    if (expected === 'DELETED' && !stack) return null;
    if (stack?.StackStatus === expected) return stack;
    if (expected === 'DELETED' && stack?.StackStatus === 'ROLLBACK_COMPLETE') { await pause(5000); continue; }
    if (stack?.StackStatus?.includes('FAILED') || stack?.StackStatus?.includes('ROLLBACK')) throw new Error('RECOVERY_STACK_OPERATION_FAILED');
    await pause(5000);
  }
  throw new Error('RECOVERY_STACK_TIMEOUT');
}

/** Exact failed free-mailbox stack only. Deletes stack metadata, never tables or table data. */
export async function recoverFailedStack(config, expected, directory, aws, pause = delay) {
  if (mailboxProvider(config) !== 'mailtm' || !config.authorization.approved
    || Date.parse(config.authorization.expiresAt) <= Date.now()) throw new Error('RECOVERY_AUTHORIZATION_REQUIRED');
  const path = directory + '/retained-table-recovery-private.json';
  let journal = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const save = () => writeFileSync(path, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
  if (journal && (journal.sourceCommit !== config.sourceCommit || journal.stackName !== config.stack
    || canonical(journal.tables) !== canonical(tableNames(config)))) throw new Error('RECOVERY_JOURNAL_MISMATCH');
  let stack = describe(aws, config.stack);
  if (isRecoveryStack(stack) && stack.StackStatus === 'IMPORT_COMPLETE') {
    checkTables(config, aws);
    assertRecoveryStack(config, stack, resources(aws, stack), body(aws('cloudformation', 'get-template', { StackName: stack.StackId }).TemplateBody), expected);
    return { status: 'RETAINED_TABLES_IMPORTED', tablesPreserved: 3, next: 'apply' };
  }
  if (!journal) {
    if (!owned(stack) || stack.StackStatus !== 'ROLLBACK_COMPLETE') throw new Error('EXACT_FAILED_STACK_REQUIRED');
    const template = body(aws('cloudformation', 'get-template', { StackName: stack.StackId, TemplateStage: 'Original' }).TemplateBody);
    if (template.Outputs?.SourceCommit?.Value !== priorSource || template.Outputs?.MailboxProvider?.Value !== 'mailtm'
      || logicalNames.some(name => canonical(template.Resources[name]) !== canonical(expected.Resources[name]))) throw new Error('FAILED_STACK_TEMPLATE_MISMATCH');
    assertResources(config, resources(aws, stack), true);
    checkTables(config, aws);
    journal = { sourceCommit: config.sourceCommit, stackName: config.stack, stackId: stack.StackId,
      tables: tableNames(config), phase: 'VERIFIED', changeSetId: null };
    save();
  }
  if (stack && stack.StackId === journal.stackId) {
    if (stack.StackStatus === 'ROLLBACK_COMPLETE') {
      if (!owned(stack)) throw new Error('FAILED_STACK_OWNERSHIP_CHANGED');
      assertResources(config, resources(aws, stack), true);
      checkTables(config, aws);
      aws('cloudformation', 'delete-stack', { StackName: journal.stackId });
    } else if (stack.StackStatus !== 'DELETE_IN_PROGRESS') throw new Error('FAILED_STACK_CHANGED');
    await waitStack(aws, journal.stackId, 'DELETED', pause);
    stack = describe(aws, config.stack);
  }
  if (stack && (!journal.changeSetId || stack.StackId !== journal.importStackId)) throw new Error('RECOVERY_NEW_STACK_CONFLICT');
  checkTables(config, aws);
  if (!journal.changeSetId) {
    const imported = recoveryTemplate(config, expected);
    const change = aws('cloudformation', 'create-change-set', {
      StackName: config.stack, ChangeSetName: 'retain-qa-tables-' + config.sourceCommit.slice(0, 12),
      ChangeSetType: 'IMPORT', TemplateBody: JSON.stringify(imported),
      ResourcesToImport: logicalNames.map(name => ({ ResourceType: 'AWS::DynamoDB::Table',
        LogicalResourceId: name, ResourceIdentifier: { TableName: journal.tables[name] } })),
      Tags: [{ Key: 'KnownEnoughQa', Value: 'true' }],
    });
    journal.changeSetId = change.Id; journal.importStackId = change.StackId; journal.phase = 'IMPORT_PREPARED'; save();
  }
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const change = aws('cloudformation', 'describe-change-set', { ChangeSetName: journal.changeSetId });
    if (change.ExecutionStatus === 'EXECUTE_COMPLETE' || change.ExecutionStatus === 'EXECUTE_IN_PROGRESS') { ready = true; break; }
    if (change.Status === 'CREATE_COMPLETE') {
      const changes = change.Changes?.map(item => item.ResourceChange) ?? [];
      if (changes.length !== 3 || new Set(changes.map(item => item.LogicalResourceId)).size !== 3
        || changes.some(item => item.Action !== 'Import' || item.ResourceType !== 'AWS::DynamoDB::Table'
          || !logicalNames.includes(item.LogicalResourceId))) throw new Error('RECOVERY_CHANGE_SET_SCOPE_MISMATCH');
      checkTables(config, aws);
      aws('cloudformation', 'execute-change-set', { ChangeSetName: journal.changeSetId });
      ready = true; break;
    }
    if (change.Status === 'FAILED') throw new Error('RECOVERY_IMPORT_CHANGE_SET_FAILED');
    await pause(5000);
  }
  if (!ready) throw new Error('RECOVERY_CHANGE_SET_TIMEOUT');
  const imported = await waitStack(aws, config.stack, 'IMPORT_COMPLETE', pause);
  assertRecoveryStack(config, imported, resources(aws, imported), body(aws('cloudformation', 'get-template', { StackName: imported.StackId }).TemplateBody), expected);
  checkTables(config, aws);
  journal.phase = 'IMPORTED'; save();
  return { status: 'RETAINED_TABLES_IMPORTED', tablesPreserved: 3, next: 'apply' };
}
