import { KnownEnough as KE } from '@deal-table/contracts';
import { safeCatalogCounts } from '../../scripts/live-qa/catalog-counts.mjs';
import { describe, expect, it } from 'vitest';
import { safeKernelCodes, safeRuleFailureKinds } from '../../scripts/live-qa/kernel-codes.mjs';
import { diagnosePendingCandidate, classifyFailedRules, evaluateFiniteEnumCatalog } from '../../scripts/live-qa/kernel-diagnostics.ts';
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

it('bounds finite variant evaluation, preserves private input and returns only aggregate counts',async()=>{
 const variable=KE.DecisionVariable.parse({id:'choice',label:'Choice',ownerParticipantId:null,type:'ENUM',visibility:'PUBLIC',required:true,options:[{id:'a',label:'A'},{id:'b',label:'B'}]});
 const candidate={values:[],permissionDependencies:[]} as unknown as KE.CandidateProposal;
 const before=structuredClone(candidate);const calls:KE.CandidateProposal[]=[];
 expect(await evaluateFiniteEnumCatalog([variable],candidate,async c=>{calls.push(c);return {status:c.values[0]?.value.type==='ENUM'&&c.values[0].value.optionId==='a'?'INVALID':'NEEDS_PERMISSION'};})).toEqual({tested:2,valid:0,invalid:1,needsPermission:1,needsClarification:0});
 expect(calls).toHaveLength(2);expect(candidate).toEqual(before);
 let invoked=false;expect(await evaluateFiniteEnumCatalog(Array.from({length:5},(_,i)=>({...variable,id:'v'+i})),candidate,async()=>{invoked=true;return {status:'VALID'};})).toBeNull();expect(invoked).toBe(false);
 expect(safeCatalogCounts({tested:1,valid:1,invalid:0,needsPermission:0,needsClarification:0,secret:'PRIVATE'})).toBeNull();
 expect(safeCatalogCounts({tested:2,valid:1,invalid:0,needsPermission:0,needsClarification:0})).toBeNull();
});
