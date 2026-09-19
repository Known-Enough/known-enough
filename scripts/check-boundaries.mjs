import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
const root = process.cwd();
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', 'dist'].includes(e.name)) return [];
    const path = `${dir}/${e.name}`;
    return e.isDirectory() ? files(path) : [path];
  });
}
const under = (file, dir) => file === dir || file.startsWith(`${dir}${sep}`);
let count = 0;
for (const area of ['apps/web', 'packages/contracts', 'packages/domain', 'packages/application', 'packages/adapters', 'apps/api', 'apps/workers']) {
  const manifest = JSON.parse(readFileSync(`${area}/package.json`, 'utf8'));
  const allowed = area === 'apps/web' ? ['@deal-table/contracts', 'react', 'react-dom', 'vite']
    : area === 'packages/contracts' ? ['zod']
    : area === 'packages/domain' ? ['@deal-table/contracts']
    : area === 'packages/application' ? ['@deal-table/contracts', '@deal-table/domain'] : null;
  if (allowed) for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (!allowed.includes(dep)) throw new Error(`Unapproved ${area} dependency: ${dep}`);
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
      } else if (allowed && !allowed.some(dep => spec === dep || spec.startsWith(`${dep}/`))) {
        throw new Error(`Forbidden import ${file}: ${spec}`);
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
