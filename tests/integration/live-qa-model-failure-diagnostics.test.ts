import {expect,test} from 'vitest';
import {MODEL_FAILURE_STAGES} from '@deal-table/application';
// @ts-expect-error Standalone JavaScript privacy parser is exercised directly.
import {modelFailuresFromLogs,safeModelFailures} from '../../scripts/live-qa/model-failure-diagnostics.mjs';
// @ts-expect-error Standalone report validates only safe diagnostic fields.
import {qualificationReport} from '../../scripts/live-qa/runner-core.mjs';
test.each(['PROVIDER_ACCESS_DENIED', 'PROVIDER_INTERNAL', 'PROVIDER_MODEL_ERROR', 'PROVIDER_NOT_READY',
 'PROVIDER_TIMEOUT', 'PROVIDER_NOT_FOUND', 'PROVIDER_UNAVAILABLE', 'PROVIDER_THROTTLED', 'PROVIDER_VALIDATION'])(
 'retains fixed provider category %s through private log parser and public report', stage => {
  const value={kind:'OWNER',stage}; const safe=modelFailuresFromLogs([
   {message:'synthetic-id INFO '+JSON.stringify({event:'ke14-model-failure',...value})},
   {message:JSON.stringify({event:'ke14-model-failure',...value,message:'PRIVATE_BODY',requestId:'PRIVATE_ID'})}]);
  expect(safe).toEqual([value]); expect(qualificationReport({runId:'run-12345',modelFailures:safe}).modelFailures).toEqual([value]);
  expect(JSON.stringify(safe)).not.toMatch(/PRIVATE|synthetic|Exception|requestId|message/);
 });
test('every declared runtime diagnostic survives the strict standalone report boundary',()=>{
 const values=MODEL_FAILURE_STAGES.map(stage=>({kind:'OWNER',stage}));
 expect(safeModelFailures(values)).toEqual(values);
});
test('extracts bounded fixed model stages while discarding raw log metadata and duplicates',()=>{
 const events=[{message:'synthetic-time synthetic-id INFO '+JSON.stringify({event:'ke14-model-failure',kind:'OWNER',stage:'PROVIDER'})},{message:JSON.stringify({event:'ke14-model-failure',kind:'OWNER',stage:'PROVIDER'})},{message:'PRIVATE_BEARER_AND_PAYLOAD'},{message:JSON.stringify({event:'ke14-model-failure',kind:'OWNER',stage:'PRIVATE',payload:'PRIVATE'})}];
 const safe=modelFailuresFromLogs(events);expect(safe).toEqual([{kind:'OWNER',stage:'PROVIDER'}]);expect(JSON.stringify(safe)).not.toMatch(/PRIVATE|synthetic/);
 expect(qualificationReport({runId:'run-12345',modelFailures:safe}).modelFailures).toEqual(safe);
});
test('unknown readback differs from observed no failures and forged extras cannot leak',()=>{
 expect(qualificationReport({runId:'run-12345'}).modelFailures).toBeNull();expect(qualificationReport({runId:'run-12345',modelFailures:[]}).modelFailures).toEqual([]);
 expect(safeModelFailures([{kind:'OWNER',stage:'PROVIDER',secret:'PRIVATE'},{kind:'PRIVATE',stage:'PROVIDER'},null])).toEqual([]);
 expect(modelFailuresFromLogs([{message:'malformed {'},{message:'[]'},{message:JSON.stringify({event:'other',kind:'OWNER',stage:'PROVIDER'})}])).toEqual([]);
});

test('retains declared negotiation validation stages without private metadata',()=>{
 expect(modelFailuresFromLogs([{message:JSON.stringify({event:'ke14-model-failure',kind:'NEGOTIATION',stage:'NEGOTIATION_QUESTION_INTENTS'})},{message:JSON.stringify({event:'ke14-model-failure',kind:'NEGOTIATION',stage:'NEGOTIATION_QUESTION_INTENTS',reason:'PRIVATE_CANARY'})}])).toEqual([{kind:'NEGOTIATION',stage:'NEGOTIATION_QUESTION_INTENTS'}]);
});


test('coverage diagnostics preserve only the fixed stage and reject private extras', () => {
 expect(modelFailuresFromLogs([{ message: JSON.stringify({ event: 'ke14-model-failure', kind: 'NEGOTIATION', stage: 'NEGOTIATION_QUESTION_COVERAGE' }) },
  { message: JSON.stringify({ event: 'ke14-model-failure', kind: 'NEGOTIATION', stage: 'NEGOTIATION_QUESTION_COVERAGE', reason: 'PRIVATE_CANARY' }) }]))
  .toEqual([{ kind: 'NEGOTIATION', stage: 'NEGOTIATION_QUESTION_COVERAGE' }]);
});
