import { describe, expect, it } from 'vitest';
import { safeKernelCodes } from '../../scripts/live-qa/kernel-codes.mjs';
import { diagnosePendingCandidate } from '../../scripts/live-qa/kernel-diagnostics.ts';
describe('QA kernel diagnostics', () => {
  it('projects only deduplicated declared codes, never identifiers or raw diagnostics', () => {
    expect(safeKernelCodes(['RULE_FAILED','PRIVATE_CANARY',{code:'RULE_FAILED',ownerParticipantId:'PRIVATE_CANARY'},'RULE_FAILED','INVALID_VALUE'])).toEqual(['INVALID_VALUE','RULE_FAILED']);
    expect(safeKernelCodes({code:'RULE_FAILED'})).toEqual([]);
  });
  it('keeps absent pending input unknown without inventing a pass', async () => {
    expect(await diagnosePendingCandidate(null)).toEqual({status:'UNKNOWN',codes:[]});
  });
});
