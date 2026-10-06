import {test, expect} from 'vitest';
// @ts-expect-error Standalone JavaScript configuration exercised directly.
import {qa05Allowance} from '../../scripts/live-qa/config.mjs';
const a={mode:'standing',approved:true,maxAttemptsPerRun:200,maxTokensPerRun:250000,maxCostMicrosPerRun:250000,attemptCostMicros:100,maxSignupMessagesPerRun:1,retentionReviewed:true,invocationLoggingDisabled:true};
test('authorized minimum extension is idempotent, preserves greater limits and unrelated safeguards',()=>{
 const next=qa05Allowance(a);expect(next).toEqual({...a,maxTokensPerRun:2500000,maxCostMicrosPerRun:2500000});
 expect(a.maxTokensPerRun).toBe(250000);expect(qa05Allowance(next)).toEqual(next);
 const greater={...a,maxTokensPerRun:5000000,maxCostMicrosPerRun:6000000,maxAttemptsPerRun:300};expect(qa05Allowance(greater)).toEqual(greater);
 expect(()=>qa05Allowance({...a,approved:false})).toThrow('AUTHORIZATION_BLOCKED');
});
