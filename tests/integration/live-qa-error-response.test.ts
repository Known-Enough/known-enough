import { expect, test } from 'vitest';
import { qaUnavailable, qaReadableFailure } from '../../scripts/live-qa/error-response.ts';
const allowed='https://main.qaexample.amplifyapp.com';
test('approved browser can read the fixed unavailable response without private diagnostics',()=>{
  const result=qaUnavailable({headers:{Origin:allowed,authorization:'Bearer PRIVATE',other:'PRIVATE'}},allowed);
  expect(result.statusCode).toBe(503);expect(result.headers).toMatchObject({'access-control-allow-origin':allowed,'cache-control':'no-store',vary:'Origin'});
  expect(result.body).toBe(JSON.stringify({ok:false,error:{code:'QA_NOT_READY'}}));expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
test('failure CORS never reflects foreign, duplicate, malformed or missing origin configuration',()=>{
  for(const headers of [{origin:'https://evil.invalid'},{origin:allowed,Origin:allowed},{origin:allowed+'/'},{origin:'null'},{}, {origin:['PRIVATE']}]) expect(qaUnavailable({headers},allowed).headers).not.toHaveProperty('access-control-allow-origin');
  for(const config of [undefined,'http://main.qaexample.amplifyapp.com',allowed+'/',allowed+'?private=value','https://user:PRIVATE@main.qaexample.amplifyapp.com']) expect(qaUnavailable({headers:{origin:config}},config).headers).not.toHaveProperty('access-control-allow-origin');
});

test('returned handler error keeps status/body and gains only exact-origin CORS',()=>{
 const result={statusCode:503,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({ok:false,error:{code:'RETRYABLE_SERVER_ERROR'}}),isBase64Encoded:false as const};
 const readable=qaReadableFailure(result,{headers:{origin:allowed}},allowed);
 expect(readable.body).toBe(result.body);expect(readable.statusCode).toBe(503);expect(readable.headers['access-control-allow-origin']).toBe(allowed);expect(result.headers).not.toHaveProperty('access-control-allow-origin');
 for(const headers of [{origin:'https://foreign.invalid'},{origin:allowed,Origin:allowed},{}])expect(qaReadableFailure(result,{headers},allowed)).toBe(result);
 expect(qaReadableFailure({...result,statusCode:200},{headers:{origin:allowed}},allowed).headers).not.toHaveProperty('access-control-allow-origin');
 const existing={...result,headers:{'Access-Control-Allow-Origin':allowed}};expect(qaReadableFailure(existing,{headers:{origin:allowed}},allowed)).toBe(existing);
});
