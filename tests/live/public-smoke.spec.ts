import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect, type Browser } from '@playwright/test';

type ExpectedFile = {
  path: string;
  sha256: string;
  bytes?: number;
  mediaType: 'text/html' | 'javascript' | 'text/css';
};

type PublicTarget = {
  id: string;
  kind: string;
  frontendUrl: string;
  frontend: {
    sourceCommit: string;
    lastVerifiedAt: string;
    files: ExpectedFile[];
  };
  backend: {
    status: 'not-applicable' | 'last-verified';
    apiBaseUrl: string | null;
    expectedArtifactSha256: string | null;
    sourceCommit?: string | null;
    lastVerifiedAt?: string;
  };
  unauthenticatedApiProbe?: {
    method: 'GET';
    path: string;
    expectedStatus: number;
  };
  page: {
    heading: string;
    keyboard: {
      mode: 'no-controls' | 'first-button-focus';
      expectedFocusableCount?: number;
      role?: 'button';
      name?: string;
    };
  };
};

const manifest = JSON.parse(readFileSync(new URL('./targets.json', import.meta.url), 'utf8')) as {
  schemaVersion: number;
  purpose: string;
  targets: PublicTarget[];
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const assetReference = /\b(?:src|href)=["']([^"']+\.(?:m?js|css)(?:\?[^"']*)?)["']/gi;

function validateManifest(): void {
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.purpose).toBe('LAT01 public, unauthenticated smoke only');
  expect(manifest.targets.length).toBeGreaterThan(0);
  expect(new Set(manifest.targets.map(target => target.id)).size).toBe(manifest.targets.length);

  for (const target of manifest.targets) {
    expect(target.id).toMatch(/^[a-z0-9-]+$/);
    expect(new URL(target.frontendUrl).protocol).toBe('https:');
    expect(target.frontend.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(target.frontend.files.length).toBeGreaterThan(0);
    expect(target.frontend.files[0]?.path).toBe('/');
    expect(target.frontend.files[0]?.mediaType).toBe('text/html');
    expect(new Set(target.frontend.files.map(file => file.path)).size).toBe(target.frontend.files.length);

    for (const file of target.frontend.files) {
      expect(file.path.startsWith('/')).toBe(true);
      expect(file.path.includes('..')).toBe(false);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      if (file.bytes !== undefined) expect(file.bytes).toBeGreaterThan(0);
    }

    if (target.backend.status === 'not-applicable') {
      expect(target.backend.apiBaseUrl).toBeNull();
      expect(target.backend.expectedArtifactSha256).toBeNull();
    } else {
      expect(target.backend.apiBaseUrl).toMatch(/^https:\/\//);
      expect(target.backend.expectedArtifactSha256).toMatch(/^[0-9a-f]{64}$/);
    }

    if (target.unauthenticatedApiProbe) {
      expect(target.backend.apiBaseUrl).not.toBeNull();
      expect(target.unauthenticatedApiProbe.path.startsWith('/')).toBe(true);
      expect(target.unauthenticatedApiProbe.path.includes('..')).toBe(false);
      expect(target.unauthenticatedApiProbe.expectedStatus).toBe(401);
    }
  }
}

function contentTypeMatches(header: string | undefined, mediaType: ExpectedFile['mediaType']): boolean {
  const value = (header ?? '').toLowerCase();
  if (mediaType === 'text/html') return value.includes('text/html');
  if (mediaType === 'text/css') return value.includes('text/css');
  return value.includes('javascript') || value.includes('ecmascript');
}

async function observeBrowser(target: PublicTarget, browser: Browser, width: number): Promise<void> {
  const pageErrors: string[] = [];
  const targetOrigin = new URL(target.frontendUrl).origin;
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: width < 500,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('request', request => {
    if (new URL(request.url()).origin !== targetOrigin) pageErrors.push('off-origin-network-request');
  });
  page.on('pageerror', () => pageErrors.push('uncaught-page-error'));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push('console-error');
  });
  page.on('requestfailed', request => {
    const protocol = new URL(request.url()).protocol;
    if (protocol === 'http:' || protocol === 'https:') pageErrors.push('failed-network-request');
  });

  try {
    const response = await page.goto(target.frontendUrl, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: target.page.heading, exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

test('LAT01 target manifest contains exact public target identities and bounded hashes', () => {
  expect(() => validateManifest()).not.toThrow();
});

for (const target of manifest.targets) {
  test(target.id + ': root and registered assets match the pinned public release', async ({ request }) => {
    validateManifest();
    const root = await request.get(target.frontendUrl, { timeout: 20_000 });
    expect(root.status()).toBe(200);
    const html = await root.body();
    const rootFile = target.frontend.files[0]!;
    expect(contentTypeMatches(root.headers()['content-type'], rootFile.mediaType)).toBe(true);
    expect(sha256(html)).toBe(rootFile.sha256);
    if (rootFile.bytes !== undefined) expect(html.byteLength).toBe(rootFile.bytes);

    const expectedPaths = new Set(target.frontend.files.map(file => file.path));
    for (const [, reference] of html.toString('utf8').matchAll(assetReference)) {
      if (!reference) continue;
      const url = new URL(reference, target.frontendUrl);
      expect(url.origin).toBe(new URL(target.frontendUrl).origin);
      expect(expectedPaths.has(url.pathname)).toBe(true);
    }

    for (const file of target.frontend.files.slice(1)) {
      const url = new URL(file.path, target.frontendUrl);
      const response = await request.get(url.toString(), { timeout: 20_000 });
      expect(response.status()).toBe(200);
      const body = await response.body();
      expect(contentTypeMatches(response.headers()['content-type'], file.mediaType)).toBe(true);
      expect(sha256(body)).toBe(file.sha256);
      if (file.bytes !== undefined) expect(body.byteLength).toBe(file.bytes);
    }
  });

  test(target.id + ': desktop browser loads without errors', async ({ browser }) => {
    await observeBrowser(target, browser, 1280);
  });

  test(target.id + ': mobile browser fits the viewport', async ({ browser }) => {
    await observeBrowser(target, browser, 390);
  });

  test(target.id + ': keyboard behavior matches the public page controls', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
      await page.goto(target.frontendUrl, { waitUntil: 'networkidle' });
      if (target.page.keyboard.mode === 'no-controls') {
        await expect(page.locator('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).toHaveCount(
          target.page.keyboard.expectedFocusableCount ?? 0,
        );
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
        return;
      }

      const control = page.getByRole(target.page.keyboard.role!, { name: target.page.keyboard.name!, exact: true });
      await page.keyboard.press('Tab');
      await expect(control).toBeFocused();
      const focusRing = await control.evaluate(element => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
      });
      expect(focusRing).toBe(true);
    } finally {
      await context.close();
    }
  });

  if (target.unauthenticatedApiProbe) {
    test(target.id + ': unauthenticated API access is denied', async ({ request }) => {
      const probe = target.unauthenticatedApiProbe!;
      const response = await request.get(new URL(probe.path, target.backend.apiBaseUrl!).toString(), { timeout: 20_000 });
      expect(response.status()).toBe(probe.expectedStatus);
      await response.dispose();
    });
  }
}
