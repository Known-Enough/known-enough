import { expect, test, vi } from 'vitest';
// @ts-expect-error QA tooling is intentionally standalone JavaScript.
import { collectGatewayThrottle, safeGatewayThrottle } from '../../scripts/live-qa/gateway-diagnostics.mjs';
// @ts-expect-error QA tooling is intentionally standalone JavaScript.
import { qualificationReport } from '../../scripts/live-qa/runner-core.mjs';
test('reads exactly the target QA stage once and publishes only bounded numeric settings', () => {
 const execute=vi.fn(()=>({DefaultRouteSettings:{ThrottlingRateLimit:5,ThrottlingBurstLimit:10},secret:'PRIVATE'}));
 expect(collectGatewayThrottle({ApiUrl:'https://abc123.execute-api.us-east-1.amazonaws.com'},execute)).toEqual({rate:5,burst:10});
 expect(execute.mock.calls).toEqual([['apigatewayv2','get-stage',{ApiId:'abc123',StageName:'$default'}]]);
});
test('unknown observations are null, genuine zero is retained, no unsafe errors or target reads',()=>{
 expect(safeGatewayThrottle({DefaultRouteSettings:{ThrottlingRateLimit:0,ThrottlingBurstLimit:0}})).toEqual({rate:0,burst:0});
 for(const value of [undefined,{}, {DefaultRouteSettings:{ThrottlingRateLimit:'PRIVATE',ThrottlingBurstLimit:10}}, {DefaultRouteSettings:{ThrottlingRateLimit:5,ThrottlingBurstLimit:Infinity}}])expect(safeGatewayThrottle(value)).toBeNull();
 const execute=vi.fn(()=>{throw new Error('PRIVATE_TOKEN');});
 expect(collectGatewayThrottle({ApiUrl:'https://foreign.example'},execute)).toBeNull();expect(execute).not.toHaveBeenCalled();
 expect(collectGatewayThrottle({ApiUrl:'https://abc123.execute-api.us-east-1.amazonaws.com'},execute)).toBeNull();expect(execute).toHaveBeenCalledTimes(1);
 const report=qualificationReport({runId:'run-12345',gatewayThrottle:{rate:5,burst:10,secret:'PRIVATE'}});
 expect(report.gatewayThrottle).toEqual({rate:5,burst:10});expect(JSON.stringify(report)).not.toContain('PRIVATE');
 expect(qualificationReport({runId:'run-12345'}).gatewayThrottle).toBeNull();
});

test('projects fixed observation outcomes without publishing raw AWS denials',()=>{
 const statuses:string[]=[];const target={ApiUrl:'https://abc123.execute-api.us-east-1.amazonaws.com'};
 const denied=Object.assign(new Error('PRIVATE_TOKEN'),{awsCode:'AccessDeniedException'});
 expect(collectGatewayThrottle(target,()=>{throw denied;},(s:string)=>statuses.push(s))).toBeNull();
 expect(collectGatewayThrottle(target,()=>{throw new Error('PRIVATE');},(s:string)=>statuses.push(s))).toBeNull();
 expect(collectGatewayThrottle(target,()=>({}),(s:string)=>statuses.push(s))).toBeNull();
 expect(statuses).toEqual(['ACCESS_DENIED','AWS_READ_FAILED','INVALID_SETTINGS']);
 expect(qualificationReport({runId:'run-12345',gatewayObservation:'ACCESS_DENIED'}).gatewayObservation).toBe('ACCESS_DENIED');
 expect(qualificationReport({runId:'run-12345',gatewayObservation:'PRIVATE'}).gatewayObservation).toBeNull();
});
