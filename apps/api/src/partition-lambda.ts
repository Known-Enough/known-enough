import { createPartitionRuntime, type PartitionRuntimeOptions } from './partition-runtime.ts';
import { invokeHttpApi, type HttpApiEvent, type HttpApiResult } from './ke13b-lambda.ts';

function invalid(statusCode: 422 | 503): HttpApiResult {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify({ ok: false, requestId: 'invalid-request',
      error: { code: statusCode === 422 ? 'INVALID_COMMAND' : 'RETRYABLE_SERVER_ERROR', httpStatus: statusCode } }),
    isBase64Encoded: false };
}

function hasControlOrSpace(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}

/** Explicit, inactive Lambda composition. The operator supplies the verified
 * private manifest/configuration; requests cannot select storage or identity.
 * No installed handler or environment selector imports this factory yet.
 */
export function createPartitionLambdaHandler(options: PartitionRuntimeOptions): (event: HttpApiEvent) => Promise<HttpApiResult> {
  const listener = createPartitionRuntime(options);
  return async event => {
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event) || event.version !== '2.0') return invalid(503);
      const path = event.rawPath; const query = event.rawQueryString;
      if (typeof path !== 'string' || (query !== undefined && typeof query !== 'string')) return invalid(422);
      const target = query ? `${path}?${query}` : path;
      if (target.length > 2048 || !path.startsWith('/') || path.startsWith('//')
        || hasControlOrSpace(path) || /[\\?#]/.test(path)
        || (query !== undefined && (hasControlOrSpace(query) || /[\\#]/.test(query)))) return invalid(422);
      // Gateway v2 separates query from rawPath; the Node listener needs both.
      // The shared transport forwards only its existing header/body allowlists.
      return await invokeHttpApi(listener, { ...event, rawPath: target });
    } catch { return invalid(503); }
  };
}
