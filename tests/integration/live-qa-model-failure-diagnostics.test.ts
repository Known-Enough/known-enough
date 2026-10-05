import {expect,test} from 'vitest';
// @ts-expect-error Standalone JavaScript privacy parser is exercised directly.
import {modelFailuresFromLogs,safeModelFailures} from '../../scripts/live-qa/model-failure-diagnostics.mjs';
// @ts-expect-error Standalone report validates only safe diagnostic fields.
import {qualificationReport} from '../../scripts/live-qa/runner-core.mjs';
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
