import { createPartitionRuntime, type PartitionRuntimeOptions } from './partition-runtime.ts';
import { gatewayFailure, invokeHttpApi, type HttpApiEvent, type HttpApiResult } from './ke13b-lambda.ts';

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
      if (!event || typeof event !== 'object' || Array.isArray(event) || event.version !== '2.0') return gatewayFailure(event, 503, options.allowedOrigin, 'REQUEST');
      const path = event.rawPath; const query = event.rawQueryString;
      if (typeof path !== 'string' || (query !== undefined && typeof query !== 'string')) return gatewayFailure(event, 422, options.allowedOrigin, 'REQUEST');
      const target = query ? `${path}?${query}` : path;
      if (target.length > 2048 || !path.startsWith('/') || path.startsWith('//')
        || hasControlOrSpace(path) || /[\\?#]/.test(path)
        || (query !== undefined && (hasControlOrSpace(query) || /[\\#]/.test(query)))) return gatewayFailure(event, 422, options.allowedOrigin, 'REQUEST');
      // Gateway v2 separates query from rawPath; the Node listener needs both.
      // The shared transport forwards only its existing header/body allowlists.
      return await invokeHttpApi(listener, { ...event, rawPath: target }, options.allowedOrigin);
    } catch (error) { return gatewayFailure(event, 503, options.allowedOrigin, 'RUNTIME_DISPATCH', error); }
  };
}
