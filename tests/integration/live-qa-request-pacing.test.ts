import { expect, test } from 'vitest';
// @ts-expect-error Standalone workload JavaScript.
import { createRequestPacer } from '../../scripts/live-qa/request-pacing.mjs';
test('concurrent browser and direct callers reserve separate request starts without issuing retries',async()=>{
 const waits:number[]=[];let now=10000;
 const pace=createRequestPacer(()=>now,async(ms:number)=>{waits.push(ms);now+=ms;});
 await Promise.all([pace(),pace(),pace()]);expect(waits).toEqual([1000,1000]);
 now=20000;await pace();expect(waits).toEqual([1000,1000]);
 now=20000;await pace();expect(waits).toEqual([1000,1000,1000]);
});
