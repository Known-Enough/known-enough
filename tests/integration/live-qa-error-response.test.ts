import { expect, test } from 'vitest';
import { qaUnavailable } from '../../scripts/live-qa/error-response.ts';
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
