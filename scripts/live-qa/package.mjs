import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { digest } from './config.mjs';
import { privateDirectory } from './private-directory.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function run(cmd, args, cwd = root) {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    if (r.status !== 0)
        throw new Error('PACKAGE_COMMAND_FAILED');
    return r.stdout.trim();
}
export async function buildPackage(directory, sourceCommit) {
    if (!/^[0-9a-f]{40}$/.test(sourceCommit))
        throw new Error('INVALID_SOURCE_COMMIT');
    if (process.versions.node !== '24.21.0' || run('npm', ['--version']) !== '11.19.0')
        throw new Error('PINNED_RUNTIME_REQUIRED');
    const out = privateDirectory(directory, root);
    const sourceFiles = [];
    for (const area of ['apps/api/src', 'packages', 'scripts/live-qa']) {
        const scan = path => {
            for (const e of readdirSync(path, { withFileTypes: true })) {
                if (['node_modules', 'dist'].includes(e.name))
                    continue;
                const p = resolve(path, e.name);
                if (e.isDirectory())
                    scan(p);
                else if (/\.(?:ts|mjs|json)$/.test(p))
                    sourceFiles.push({ path: p.slice(root.length + 1), sha256: digest(readFileSync(p)) });
            }
        };
        scan(resolve(root, area));
    }
    const manifest = { schemaVersion: 1, sourceCommit, sourceFiles: sourceFiles.sort((a, b) => a.path.localeCompare(b.path)), artifacts: {} };
    for (const [name, input] of [['api', 'entry.ts'], ['broker', 'broker.mjs']]) {
        const build = await rolldown({ input: resolve(root, 'scripts/live-qa', input), platform: 'node', external: [/^node:/] });
        await build.write({ file: resolve(out, `${name}.mjs`), format: 'es', codeSplitting: false, minify: false });
        await build.close();
        const code = readFileSync(resolve(out, `${name}.mjs`));
        if (/packages\/test-support|NON_PRODUCTION|NP_PRIVATE_RAW_CANARY|ke14Fixture/.test(code.toString()))
            throw new Error('FIXTURE_CONTENT_IN_PACKAGE');
        run('python3', [
            '-c', "import zipfile,pathlib,sys; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p.with_suffix('.zip'),'w',zipfile.ZIP_DEFLATED,compresslevel=9); i=zipfile.ZipInfo(p.name,(2026,10,1,0,0,0)); i.compress_type=zipfile.ZIP_DEFLATED; i.external_attr=0o100644<<16; z.writestr(i,p.read_bytes()); z.close()", resolve(out, `${name}.mjs`)
        ]);
        manifest.artifacts[name] = { sha256: digest(readFileSync(resolve(out, `${name}.zip`))), moduleSha256: digest(code), entry: name === 'api' ? 'api.qaHandler' : 'broker.handler' };
    }
    writeFileSync(resolve(out, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    return manifest;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const m = await buildPackage(process.argv[2], process.argv[3]);
        console.log(JSON.stringify({ status: 'PASS', sourceCommit: m.sourceCommit, artifacts: m.artifacts }));
    }
    catch {
        console.error('QA_PACKAGE_BUILD_FAILED');
        process.exitCode = 1;
    }
}
