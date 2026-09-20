import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/check-boundaries.mjs');
const temporaryRoots: string[] = [];
const manifests: Record<string, Record<string, string>> = {
  'apps/web': { '@deal-table/contracts': '0.1.0', react: '19.3.0', 'react-dom': '19.3.0', vite: '8.3.0' },
  'packages/contracts': { zod: '4.6.5' },
  'packages/domain': { '@deal-table/contracts': '0.1.0' },
  'packages/application': { '@deal-table/contracts': '0.1.0', '@deal-table/domain': '0.1.0' },
  'packages/adapters': { '@deal-table/application': '0.1.0', '@aws-sdk/client-dynamodb': '3.0.0' },
  'apps/api': { '@deal-table/application': '0.1.0', '@deal-table/adapters': '0.1.0', hono: '4.0.0' },
  'apps/workers': { '@deal-table/application': '0.1.0', '@deal-table/adapters': '0.1.0', '@aws-sdk/client-sqs': '3.0.0' },
};

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'deal-table-boundaries-'));
  temporaryRoots.push(root);
  for (const [area, dependencies] of Object.entries(manifests)) {
    mkdirSync(join(root, area), { recursive: true });
    writeFileSync(join(root, area, 'package.json'), JSON.stringify({ name: `fixture-${area}`, dependencies }));
  }
  return root;
}

function source(root: string, area: string, contents: string): void {
  writeFileSync(join(root, area, 'index.ts'), contents);
}

function run(root: string) {
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('workspace boundary check', () => {
  it('allows declared external packages and approved server workspace dependencies', () => {
    const root = fixture();
    source(root, 'packages/adapters', "import '@deal-table/application'; import '@aws-sdk/client-dynamodb';");
    source(root, 'apps/api', "import '@deal-table/adapters'; import 'hono/client';");
    source(root, 'apps/workers', "import '@deal-table/application'; import '@aws-sdk/client-sqs'; import 'node:crypto';");

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects a forbidden workspace dependency in a flexible server manifest', () => {
    const root = fixture();
    writeFileSync(join(root, 'packages/adapters/package.json'), JSON.stringify({
      name: 'fixture-adapters',
      dependencies: { '@deal-table/web': '0.1.0' },
    }));

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unapproved packages/adapters workspace dependency: @deal-table/web');
  });

  it('rejects forbidden workspace package subpath imports', () => {
    const root = fixture();
    source(root, 'apps/api', "import '@deal-table/domain/private';");

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Forbidden workspace import apps/api/index.ts: @deal-table/domain/private');
  });

  it.each(['packages/adapters', 'apps/api', 'apps/workers'])(
    'rejects approved but undeclared workspace imports in %s', area => {
      const root = fixture();
      source(root, area, "import '@deal-table/contracts/schemas';");

      const result = run(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Undeclared import ${area}/index.ts: @deal-table/contracts/schemas`);
    },
  );

  it('rejects undeclared external server imports', () => {
    const root = fixture();
    source(root, 'apps/api', "import 'undeclared-http/client';");

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Undeclared import apps/api/index.ts: undeclared-http/client');
  });

  it.each(['packages/domain', 'apps/api'])('allows fixture devDependencies for tests in %s', area => {
    const root = fixture();
    writeFileSync(join(root, area, 'package.json'), JSON.stringify({
      dependencies: manifests[area],
      devDependencies: { '@deal-table/test-support': '0.1.0' },
    }));
    writeFileSync(join(root, area, 'fixtures.test.ts'), "import '@deal-table/test-support';");

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
  });

  it.each(['packages/domain', 'apps/api'])('rejects fixture imports in production source in %s', area => {
    const root = fixture();
    writeFileSync(join(root, area, 'package.json'), JSON.stringify({
      dependencies: manifests[area],
      devDependencies: { '@deal-table/test-support': '0.1.0' },
    }));
    source(root, area, "import '@deal-table/test-support';");

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`import ${area}/index.ts: @deal-table/test-support`);
  });

  it.each(['packages/domain', 'apps/api'])('rejects fixture runtime dependencies in %s', area => {
    const root = fixture();
    writeFileSync(join(root, area, 'package.json'), JSON.stringify({
      dependencies: { ...manifests[area], '@deal-table/test-support': '0.1.0' },
      devDependencies: { '@deal-table/test-support': '0.1.0' },
    }));

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Unapproved ${area}`);
  });

  it('rejects fixture devDependencies in the browser workspace', () => {
    const root = fixture();
    writeFileSync(join(root, 'apps/web/package.json'), JSON.stringify({
      dependencies: manifests['apps/web'],
      devDependencies: { '@deal-table/test-support': '0.1.0' },
    }));

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unapproved apps/web dependency: @deal-table/test-support');
  });
});
