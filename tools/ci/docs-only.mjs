// Decides whether a change touches only documentation, so CI can skip the toolchain, verify and e2e steps.
// Usage: git diff --name-only A B | node tools/ci/docs-only.mjs   -> prints "true" or "false".
// CLAUDE.md is deliberately absent (the repo forbids it, tools/docs/agents-docs.test.ts). An allowlist, not `**/*.md`: the tooling reads Markdown inside content/ and tools/ (project READMEs), so any
// path not listed here counts as code. An empty list is "false" (when in doubt, run everything).
// AGENTS.md files and our skills are read only by tools/docs/agents-docs.test.ts, which docs-only runs still run. Not under
// content/modules/: src/content-runtime/course.ts bundles every .md in an exercise or project folder into the app.
import { pathToFileURL } from 'node:url';

const DOC_PATHS = [
  /^(README|PLAN|CHANGELOG)\.md$/,
  /^(?!content\/modules\/)(?:[^/]+\/)*AGENTS\.md$/,
  /^\.agents\/skills\/[^/]+\/SKILL\.md$/,
  /^\.claude\/skills\/[^/]+$/,
  /^LICENSE$/,
  /^research\//,
];

export function isDocsOnly(files) {
  return files.length > 0 && files.every((f) => DOC_PATHS.some((re) => re.test(f)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  console.log(String(isDocsOnly(input.split('\n').filter(Boolean))));
}
