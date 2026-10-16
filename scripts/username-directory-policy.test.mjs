import test from 'node:test';
import assert from 'node:assert/strict';
import { usernameDirectoryPermissions } from './username-directory-policy.mjs';

const resource = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughPartitions';
const policy = (action, keys, transaction = false) => ({ Statement: [{ Effect: 'Allow', Action: [`dynamodb:${action}`], Resource: resource,
  Condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': keys }, ...(transaction
    ? { 'ForAnyValue:StringEquals': { 'dynamodb:EnclosingOperation': ['TransactWriteItems'] } } : {}) } }] });

test('requires USERNAME prefix on reads and conditional transactional writes', () => {
  assert.deepEqual(usernameDirectoryPermissions([policy('GetItem', ['USERNAME#*']), policy('PutItem', ['USERNAME#*'], true)]),
    { read: true, transactionalWrite: true });
});

test('missing prefix, resource, or transaction fence does not count as effective permission', () => {
  assert.deepEqual(usernameDirectoryPermissions([policy('GetItem', ['ACCOUNT#*']), policy('PutItem', ['USERNAME#*'])]),
    { read: false, transactionalWrite: false });
  assert.deepEqual(usernameDirectoryPermissions([policy('GetItem', ['USERNAME#*']),
    { Statement: [{ ...policy('PutItem', ['USERNAME#*'], true).Statement[0], Resource: 'arn:aws:dynamodb:us-east-1:092954139775:table/Other' }] }]),
  { read: true, transactionalWrite: false });
});
