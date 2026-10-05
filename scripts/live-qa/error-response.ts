import type { HttpApiEvent, HttpApiResult } from '../../apps/api/src/ke13b-lambda.ts';

/** A fixed safe failure stays readable only from the exact configured HTTPS frontend. */
export function qaUnavailable(event: HttpApiEvent, allowedOrigin: string | undefined) {
  const headers: Record<string,string> = { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'Origin' };
  const origin = typeof allowedOrigin === 'string' ? URL.parse(allowedOrigin) : null;
  const incoming = event.headers && typeof event.headers === 'object' && !Array.isArray(event.headers)
    ? Object.entries(event.headers).filter(([key]) => key.toLowerCase() === 'origin').map(([,value]) => value) : [];
  if (origin?.protocol === 'https:' && origin.origin === allowedOrigin && !origin.username && !origin.password
    && incoming.length === 1 && incoming[0] === allowedOrigin) {
    headers['access-control-allow-origin'] = allowedOrigin;
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-allow-headers'] = 'Authorization, Content-Type, X-Request-Id';
  }
  return { statusCode: 503, headers, body: JSON.stringify({ ok: false, error: { code: 'QA_NOT_READY' } }), isBase64Encoded: false as const };
}

/** Preserve the trusted handler failure; attach CORS only for an exact validated browser origin. */
export function qaReadableFailure(result: HttpApiResult, event: HttpApiEvent, allowedOrigin: string | undefined): HttpApiResult {
  if (result.statusCode < 400 || result.statusCode > 599 || Object.keys(result.headers).some(key=>key.toLowerCase()==='access-control-allow-origin')) return result;
  const headers=qaUnavailable(event,allowedOrigin).headers;
  if (!headers['access-control-allow-origin']) return result;
  return {...result,headers:{...result.headers,...headers}};
}
