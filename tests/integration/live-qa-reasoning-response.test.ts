import { expect, test, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { exploreProposals } from '../live/qa/helpers.ts';

test('a failed reasoning response stops exploration without retaining its private body or retrying', async () => {
 const json = vi.fn(); const click = vi.fn().mockResolvedValue(undefined);
 const waitForResponse = vi.fn().mockResolvedValue({ ok: () => false, json });
 const off = vi.fn();
 const page = { on: vi.fn(), off, waitForResponse, getByRole: () => ({ click }) } as unknown as Page;
 const outcome = vi.fn();
 await expect(exploreProposals(page, 'https://qa.invalid/decisions/synthetic/reasoning', vi.fn(), outcome)).rejects.toThrow('QA_REASONING_REQUEST_FAILED');
 expect(waitForResponse).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1);
 expect(json).not.toHaveBeenCalled(); expect(outcome).not.toHaveBeenCalled(); expect(off).toHaveBeenCalledTimes(2);
});
