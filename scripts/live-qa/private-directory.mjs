import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
/** Temporary builds or the fixed private HOME namespace; never the repository or a symlink. */
export function privateDirectory(directory, repository) {
    const out = resolve(directory);
    const state = resolve(homedir(), 'known-enough-live-qa-state');
    const base = out.startsWith('/tmp/') ? '/tmp' : out.startsWith(state + '/') ? state : null;
    if (!base || out === repository || out.startsWith(repository + '/'))
        throw new Error('PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
    for (let path = out; path !== dirname(base); path = dirname(path)) {
        if (existsSync(path) && lstatSync(path).isSymbolicLink())
            throw new Error('PRIVATE_DIRECTORY_SYMLINK_REJECTED');
    }
    mkdirSync(out, { recursive: true, mode: 0o700 });
    chmodSync(out, 0o700);
    if (base === state)
        chmodSync(state, 0o700);
    return out;
}
