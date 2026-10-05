import { describe, expect, it } from 'vitest';
import { safeKernelCodes, safeRuleFailureKinds } from '../../scripts/live-qa/kernel-codes.mjs';
import { diagnosePendingCandidate, classifyFailedRules } from '../../scripts/live-qa/kernel-diagnostics.ts';
describe('QA kernel diagnostics', () => {
  it('projects only deduplicated declared codes, never identifiers or raw diagnostics', () => {
    expect(safeKernelCodes(['RULE_FAILED','PRIVATE_CANARY',{code:'RULE_FAILED',ownerParticipantId:'PRIVATE_CANARY'},'RULE_FAILED','INVALID_VALUE'])).toEqual(['INVALID_VALUE','RULE_FAILED']);
    expect(safeKernelCodes({code:'RULE_FAILED'})).toEqual([]);
  });
  it('keeps absent pending input unknown without inventing a pass', async () => {
    expect(await diagnosePendingCandidate(null)).toEqual({status:'UNKNOWN',codes:[]});
  });
});

it('classifies private and public rule failures without IDs, even when rule IDs overlap', () => {
 const constraints=[{constraintId:'PRIVATE_CONDITION',ownerParticipantId:'PRIVATE_OWNER',status:'ACTIVE',kind:'HARD',rule:{id:'shared-rule'}}];
 const diagnostics=[{code:'RULE_FAILED' as const,ruleId:'shared-rule'}, {code:'RULE_FAILED' as const,ruleId:'shared-rule',constraintId:'PRIVATE_CONDITION',ownerParticipantId:'PRIVATE_OWNER'}];
 expect(classifyFailedRules(diagnostics,['shared-rule'],constraints)).toEqual(['HARD_CONDITION','PUBLIC_RULE']);
 expect(classifyFailedRules(diagnostics.slice(1),['shared-rule'],[])).toEqual(['UNKNOWN_RULE']);
 expect(classifyFailedRules(diagnostics.slice(1),['shared-rule'],[...constraints,...constraints])).toEqual(['UNKNOWN_RULE']);
 expect(classifyFailedRules([{code:'INVALID_RULE',ruleId:'shared-rule'}],['shared-rule'],constraints)).toEqual([]);
 expect(safeRuleFailureKinds(['HARD_CONDITION','PRIVATE_OWNER',{kind:'PUBLIC_RULE'},'HARD_CONDITION'])).toEqual(['HARD_CONDITION']);
});
