import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { awsTransport } from './aws-transport.mjs';
import { manifestStore, MANIFEST_BUCKET } from './manifest.mjs';

const execute = promisify(execFile);
function version(value) {
  if (typeof value !== 'string' || !value.length || value.length > 1024 || value === 'null'
    || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('OPS_MANIFEST_VERSION_REQUIRED');
}
// A trusted operations worker injects these methods into the inactive TypeScript coordinator.
// No SDK dependency, workspace cross-import, CLI invocation or private file exists until a method runs.
export function partitionRecoveryStorage(executor = execute) {
  if (typeof executor !== 'function') throw new Error('OPS_IO_INVALID');
  async function invoke(method, args, context) {
    if (!context?.signal || typeof context.request !== 'function') throw new Error('OPS_IO_INVALID');
    let first = true;
    const transport = awsTransport(async (command, argv, options) => {
      // Coordinator already charged the first request; charge every additional actual AWS subprocess.
      if (!first) context.request(); first = false;
      if (context.signal.aborted) throw new Error('OPS_IO_ABORTED');
      return executor(command, argv, { ...options, signal: context.signal });
    });
    const result = await manifestStore(transport, MANIFEST_BUCKET)[method](...args);
    version(result.versionId);
    if (context.signal.aborted) throw new Error('OPS_IO_ABORTED');
    return result;
  }
  return {
    preserve(bytes, hash, context) { return invoke('preserve', [bytes, hash], context); },
    read(hash, versionId, context) {
      version(versionId);
      return invoke('read', [hash, versionId], context);
    },
  };
}
