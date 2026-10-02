import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { digest } from './config.mjs';
export function validFiles(files) {
    if (!Array.isArray(files) || !files.length || files.length > 100 || !files.some(f => f.path === '/') || files.some(f => !(f.path === '/' || /^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(f.path)) || !/^[a-f0-9]{64}$/.test(f.sha256)))
        throw new Error('EXPECTED_PUBLIC_FILES_INVALID');
    return files;
}
export async function verifyWeb(base, files) {
    validFiles(files);
    let count = 0;
    for (const f of files) {
        const response = await globalThis.fetch(new URL(f.path, base), { redirect: 'error', signal: globalThis.AbortSignal.timeout(15000), headers: { 'cache-control': 'no-cache' } });
        if (!response.ok || digest(Buffer.from(await response.arrayBuffer())) !== f.sha256)
            throw new Error('PUBLIC_ARTIFACT_MISMATCH');
        count++;
    }
    return count;
}
export async function publicChecks(receiptFile, output) {
    let browser;
    const result = { schemaVersion: 1, status: 'BLOCKED_OR_FAILED', primary: 'BLOCKED', qa: 'BLOCKED', staticPreview: 'BLOCKED', counts: 0 };
    try {
        const r = JSON.parse(readFileSync(receiptFile, 'utf8'));
        if (!/^[a-f0-9]{40}$/.test(r.sourceCommit ?? ''))
            throw new Error('EXPECTED_SOURCE_INVALID');
        result.sourceCommit = r.sourceCommit;
        if (r.primary?.FrontendUrl !== 'https://main.d143q5ravxp5av.amplifyapp.com/' || !/^https:\/\/main\.[a-z0-9]+\.amplifyapp\.com\/$/.test(r.targetFrontend))
            throw new Error('PUBLIC_TARGET_INVALID');
        result.counts += await verifyWeb(r.primary.FrontendUrl, r.primary.files);
        result.counts += await verifyWeb(r.targetFrontend, r.webFiles);
        const stable = JSON.parse(readFileSync('tests/live/targets.json', 'utf8')).targets.find(t => t.id === 'stage0-static-preview');
        if (stable.frontendUrl !== 'https://d23eowhnwtqts3.cloudfront.net/')
            throw new Error('STATIC_TARGET_CHANGED');
        result.counts += await verifyWeb(stable.frontendUrl, stable.frontend.files);
        result.staticPreview = 'PASS';
        browser = await chromium.launch();
        for (const [lane, url] of [['primary', r.primary.FrontendUrl], ['qa', r.targetFrontend]]) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
            try {
                const page = await context.newPage();
                await page.goto(url);
                await page.getByRole('button', { name: 'Sign in or register', exact: true }).waitFor();
                await page.keyboard.press('Tab');
                if (!await page.getByRole('button', { name: 'Sign in or register', exact: true }).evaluate(e => e === document.activeElement) || !await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth))
                    throw new Error('PUBLIC_SCREEN_ASSERTION_FAILED');
                result[lane] = 'PASS';
                result.counts += 2;
            }
            finally {
                await context.close();
            }
        }
        for (const base of [r.primary.ApiUrl, r.targetApi]) {
            const response = await globalThis.fetch(base + '/decisions/qa-unauthenticated-probe/public', { redirect: 'error', signal: globalThis.AbortSignal.timeout(15000) });
            if (response.status !== 401)
                throw new Error('API_UNAUTHENTICATED_READ_ALLOWED');
            result.counts++;
        }
        result.status = 'PASS';
    }
    catch { /* Static allowlisted result only. */
    }
    finally {
        await browser?.close();
        writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    }
    return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const report = await publicChecks(process.argv[2], process.argv[3]);
        console.log(JSON.stringify(report));
        if (report.status !== 'PASS')
            process.exitCode = 1;
    }
    catch {
        console.error('PUBLIC_CHECK_BLOCKED');
        process.exitCode = 1;
    }
}
