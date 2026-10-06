import {test, expect} from 'vitest';
// @ts-expect-error Standalone JavaScript aggregate privacy projection exercised directly.
import {safeBudgetEvidence} from '../../scripts/live-qa/budget-evidence.mjs';
// @ts-expect-error Standalone JavaScript qualification projection exercised directly.
import {qualificationReport} from '../../scripts/live-qa/runner-core.mjs';
const observed = {attempts:7,reservedTokens:240000,reservedCostMicros:240000,maxAttemptsPerRun:200,maxTokensPerRun:250000,maxCostMicrosPerRun:300000};
test('qualification retains aggregate reservations without converting unknown limits to zero', () => {
 expect(qualificationReport({runId:'run-12345',budget:observed}).budget).toEqual(observed);
 expect(qualificationReport({runId:'run-12345'}).budget).toBeNull();
 expect(safeBudgetEvidence({...observed,privateValue:'secret'})).toBeNull();
 for(const value of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1,'7']) expect(safeBudgetEvidence({...observed,attempts:value})).toBeNull();
 expect(safeBudgetEvidence({...observed,maxTokensPerRun:0})).toBeNull();
 expect(safeBudgetEvidence({...observed,reservedTokens:300000})).toEqual({...observed,reservedTokens:300000});
});
