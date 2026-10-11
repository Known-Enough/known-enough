import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationDisposition, verifyOwnerPackageConfiguration } from './lifecycle-release.mjs';
const digest='a'.repeat(64);
function fixture(){return {FunctionArn:'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api',
 Role:'arn:aws:iam::092954139775:role/KnownEnoughStageApiRole',State:'Active',LastUpdateStatus:'Successful',Handler:'api.handler',
 RevisionId:'private-revision',CodeSha256:Buffer.alloc(32,2).toString('base64'),Runtime:'nodejs24.x',MemorySize:512,Timeout:30,
 Environment:{Variables:{KE13B_TABLE_NAME:'KnownEnoughStage',COGNITO_USER_POOL_ID:'us-east-1_V9OMjd0zx',COGNITO_PARTICIPANT_CLIENT_ID:'participant',
 COGNITO_DISPLAY_CLIENT_ID:'display',KE13B_ALLOWED_ORIGIN:'https://known.example.invalid',KE14_MODEL_MODE:'DISABLED',KE14_PAID_CALLS_APPROVED:'false',
 NP_GROUPS_ENABLED:'true',NP_GROUP_TABLE_NAME:'KnownEnoughGroupsStage',NP_GROUP_EMAIL_KEY:'PRIVATE_KEY_CANARY'.repeat(3),
 NP_COGNITO_DOMAIN:'https://known-primary.auth.us-east-1.amazoncognito.com'}}};}
test('only an unchanged fresh revision allows upload; lost acknowledgement with the exact installed candidate is reconciled',()=>{
 const prior=fixture();assert.equal(publicationDisposition(prior,structuredClone(prior),digest),'UPDATE');
 const installed={...prior,RevisionId:'after',CodeSha256:Buffer.from(digest,'hex').toString('base64')};
 assert.equal(publicationDisposition(prior,installed,digest),'INSTALLED');
 assert.throws(()=>publicationDisposition(prior,{...prior,RevisionId:'foreign'},digest));
 assert.throws(()=>publicationDisposition(prior,{...installed,Handler:'other'},digest));
 assert.throws(()=>publicationDisposition(prior,{...installed,Environment:{Variables:{}}},digest));
});
test('private package cannot silently drift email/identity/origin or enable a paid provider',()=>{
 const prior=fixture();const env=prior.Environment.Variables;
 const config={userPoolId:env.COGNITO_USER_POOL_ID,participantClientId:'participant',displayClientId:'display',
 cognitoDomain:env.NP_COGNITO_DOMAIN,allowedOrigin:env.KE13B_ALLOWED_ORIGIN,emailKey:env.NP_GROUP_EMAIL_KEY};
 assert.equal(verifyOwnerPackageConfiguration(prior,config),true);
 for(const field of Object.keys(config))assert.throws(()=>verifyOwnerPackageConfiguration(prior,{...config,[field]:'changed'}));
 const paid=structuredClone(prior);paid.Environment.Variables.KE14_MODEL_MODE='BEDROCK';assert.throws(()=>verifyOwnerPackageConfiguration(paid,config));
});
