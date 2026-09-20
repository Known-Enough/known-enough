import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
const root = process.cwd();
const areas = [
  'apps/web',
  'packages/contracts',
  'packages/domain',
  'packages/application',
  'packages/adapters',
  'apps/api',
  'apps/workers',
];
const strictDependencies = {
  'apps/web': ['@deal-table/contracts', 'react', 'react-dom', 'vite'],
  'packages/contracts': ['zod'],
  'packages/domain': ['@deal-table/contracts'],
  'packages/application': ['@deal-table/contracts', '@deal-table/domain'],
};
const serverWorkspaceDependencies = {
  'packages/adapters': ['@deal-table/contracts', '@deal-table/domain', '@deal-table/application'],
  'apps/api': ['@deal-table/contracts', '@deal-table/application', '@deal-table/adapters'],
  'apps/workers': ['@deal-table/contracts', '@deal-table/application', '@deal-table/adapters'],
};
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', 'dist'].includes(e.name)) return [];
    const path = `${dir}/${e.name}`;
    return e.isDirectory() ? files(path) : [path];
  });
}
const under = (file, dir) => file === dir || file.startsWith(`${dir}${sep}`);
const packageName = spec => {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};
const matchesPackage = (spec, dep) => spec === dep || spec.startsWith(`${dep}/`);
let count = 0;
for (const area of areas) {
  const manifest = JSON.parse(readFileSync(`${area}/package.json`, 'utf8'));
  const declaredDependencies = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }));
  const strictAllowed = strictDependencies[area];
  const workspaceAllowed = serverWorkspaceDependencies[area];
  for (const dep of declaredDependencies) {
    // Server tests may declare fixtures; production source still uses the allowlists below.
    if (area !== 'apps/web' && dep === '@deal-table/test-support'
      && !Object.hasOwn(manifest.dependencies ?? {}, dep)) continue;
    if (strictAllowed && !strictAllowed.includes(dep)) throw new Error(`Unapproved ${area} dependency: ${dep}`);
    if (workspaceAllowed && dep.startsWith('@deal-table/') && !workspaceAllowed.includes(dep)) {
      throw new Error(`Unapproved ${area} workspace dependency: ${dep}`);
    }
  }
  for (const file of files(area).filter(p => /\.(?:[cm]?[jt]sx?|html)$/.test(p) && !p.endsWith('.test.ts'))) {
    if (file.endsWith('.html')) {
      if (/planning-checks|test-support|docs\/reference/.test(readFileSync(file, 'utf8'))) throw new Error(`Reference imported by ${file}`);
      continue;
    }
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function check(spec) {
      count++;
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (!under(target, resolve(area))) throw new Error(`Cross-boundary relative import ${file}: ${spec}`);
      } else if (strictAllowed && !strictAllowed.some(dep => matchesPackage(spec, dep))) {
        throw new Error(`Forbidden import ${file}: ${spec}`);
      } else if (workspaceAllowed) {
        const importedPackage = packageName(spec);
        if (importedPackage.startsWith('@deal-table/') && !workspaceAllowed.includes(importedPackage)) {
          throw new Error(`Forbidden workspace import ${file}: ${spec}`);
        }
        if (!spec.startsWith('node:') && !declaredDependencies.has(importedPackage)) {
          throw new Error(`Undeclared import ${file}: ${spec}`);
        }
      }
      if (/test-support|planning-checks|docs\/reference/.test(spec)) throw new Error(`Private/reference import ${file}: ${spec}`);
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) {
        const arg = node.arguments[0];
        if (!arg || !ts.isStringLiteral(arg)) throw new Error(`Nonliteral import in ${file}`);
        check(arg.text);
      }
      if (ts.isCallExpression(node) && node.expression.getText(source).startsWith('import.meta.glob')) throw new Error(`Glob imports need boundary review: ${file}`);
      if (ts.isNewExpression(node) && node.expression.getText(source) === 'URL') {
        const arg = node.arguments?.[0];
        if (!arg || !ts.isStringLiteral(arg)) throw new Error(`Dynamic URL needs boundary review: ${file}`);
        check(arg.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (!under(resolve(file), root)) throw new Error(relative(root, file));
  }
}
console.log(`Import/dependency boundaries passed (${count} references). Tests may use server fixtures; browser source cannot.`);
