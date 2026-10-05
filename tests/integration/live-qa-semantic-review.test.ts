import { expect, test } from 'vitest';
import type { KnownEnough as KE } from '@deal-table/contracts';
import { syntheticConditionMatches } from '../live/qa/semantic-review.ts';
const expected={kind:'HARD' as const,variableId:'activity',optionId:'watering',otherOptionId:'planting'};
const condition=(rule:KE.ValidationRule,kind:'HARD'|'NEGOTIABLE'='HARD')=>({constraintId:'synthetic',kind,rule});
const eq:KE.ValidationRule={id:'rule',visibility:'TRUSTED_BACKEND',operator:'COMPARE',variableId:'activity',comparison:'EQ',value:{type:'ENUM',optionId:'watering'}};
test('review accepts equivalent exact finite meanings and the stated consent kind',()=>{
  expect(syntheticConditionMatches([condition(eq)],expected)).toBe(true);
  expect(syntheticConditionMatches([condition({id:'in-rule',visibility:'TRUSTED_BACKEND',operator:'IN',variableId:'activity',values:[eq.value]})],expected)).toBe(true);
  expect(syntheticConditionMatches([condition({...eq,comparison:'NE',value:{type:'ENUM',optionId:'planting'}})],expected)).toBe(true);
  expect(syntheticConditionMatches([condition(eq,'NEGOTIABLE')],{...expected,kind:'NEGOTIABLE'})).toBe(true);
});
test('review refuses model drift, extra conditions and broader permission before consent',()=>{
  for(const rules of [[],[condition(eq),condition(eq)],[condition(eq,'NEGOTIABLE')],[condition({...eq,variableId:'other'})],[condition({...eq,value:{type:'ENUM',optionId:'planting'}})],[condition({...eq,value:{type:'ENUM',optionId:'PRIVATE_CANARY'}})],[condition({id:'in-rule',visibility:'TRUSTED_BACKEND',operator:'IN',variableId:'activity',values:[eq.value,{type:'ENUM',optionId:'planting'}]})]]) expect(syntheticConditionMatches(rules,expected)).toBe(false);
  expect(syntheticConditionMatches([condition(eq)],{...expected,otherOptionId:'watering'})).toBe(false);
});
