// src/testing/ is shared by the app (browser), tools/exercises (Node) and check.mjs (a zero-dependency Node bundle),
// so its modules must stay environment-neutral, as their headers say: no Node or DOM APIs, and no imports from the rest
// of the repo, which may use either. Test files are exempt. The sources are parsed rather than searched with regular
// expressions, so a name inside a comment, a string or a regex literal is not a use, and code inside `${…}` is checked.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const DIR = path.dirname(fileURLToPath(import.meta.url));
/** Packages that run unchanged in the browser and in Node, and that the check.mjs bundle inlines. */
const PACKAGES = new Set(['fflate']);
/** Names that exist in only one of the two environments (`globalThis` itself is fine: sha256.ts feature-tests it). */
const GLOBALS = new Set(['document', 'window', 'self', 'localStorage', 'sessionStorage', 'navigator', 'process', 'require', 'Buffer', '__dirname', '__filename']);

const modules = readdirSync(DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));

interface Use { line: number; text: string }

/** The module specifiers a file loads at run time (type-only imports are erased) and the environment globals it names. */
function inspect(file: string): { imports: Use[]; globals: Use[] } {
  const sf = ts.createSourceFile(file, readFileSync(path.join(DIR, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const imports: Use[] = [];
  const globals: Use[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  /** `globalThis`, also behind parentheses or a cast: `(globalThis as any)`. */
  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e) ? unwrap(e.expression) : e;
  const isGlobalThis = (e: ts.Expression) => { const b = unwrap(e); return ts.isIdentifier(b) && b.text === 'globalThis'; };
  const isMemberName = (n: ts.Identifier) => {
    const p = n.parent;
    // `globalThis.process` names the global itself, so it is not a member name.
    return (ts.isPropertyAccessExpression(p) && p.name === n && !isGlobalThis(p.expression)) || (ts.isQualifiedName(p) && p.right === n)
      || ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)
        || ts.isMethodSignature(p) || ts.isEnumMember(p)) && p.name === n);
  };
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const bindings = ts.isImportDeclaration(n) ? n.importClause : n;
      const typeOnly = !!bindings && ('isTypeOnly' in bindings) && bindings.isTypeOnly;
      if (!typeOnly) imports.push({ line: at(n), text: n.moduleSpecifier.text });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0];
      imports.push({ line: at(n), text: arg && ts.isStringLiteralLike(arg) ? arg.text : '<computed import()>' });
    } else if (ts.isIdentifier(n) && GLOBALS.has(n.text) && !isMemberName(n)) {
      globals.push({ line: at(n), text: n.text });
    } else if (ts.isElementAccessExpression(n) && isGlobalThis(n.expression) && ts.isStringLiteralLike(n.argumentExpression) && GLOBALS.has(n.argumentExpression.text)) {
      globals.push({ line: at(n), text: n.argumentExpression.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { imports, globals };
}

describe('src/testing stays environment-neutral', () => {
  it('finds the shared modules (guard against checking nothing)', () => {
    expect(modules).toContain('runner.ts');
    expect(modules).toContain('token.ts');
  });

  it('has no subfolder that this test does not read', () => {
    const dirs = readdirSync(DIR, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== '__fixtures__')
      .map(e => `src/testing/${e.name}/: this test reads only the files directly in src/testing; move the modules up, or make it walk this folder`);
    expect(dirs).toEqual([]);
  });

  it('imports only its own modules and neutral packages', () => {
    const bad = modules.flatMap(f => inspect(f).imports
      .filter(u => !/^\.\/[\w.-]+$/.test(u.text) && !PACKAGES.has(u.text))
      .map(u => `${f}:${u.line}: imports '${u.text}' (src/testing also runs in the browser and in check.mjs: no node:*, no DOM code, nothing outside src/testing)`));
    expect(bad).toEqual([]);
  });

  it('uses no Node or DOM globals', () => {
    const bad = modules.flatMap(f => inspect(f).globals
      .map(u => `${f}:${u.line}: uses '${u.text}' (src/testing also runs in the browser and in check.mjs; take it as a parameter instead)`));
    expect(bad).toEqual([]);
  });
});
