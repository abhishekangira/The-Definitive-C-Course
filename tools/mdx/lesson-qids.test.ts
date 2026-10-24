import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@mdx-js/mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { describe, expect, it } from 'vitest';
import { compilerErrorQid, compilerErrorQuestions } from '../../src/content-model/compiler-error';
import remarkCourse, { lessonChoiceIds, lessonCompilerErrorIds } from './remark-course';

// The `?frontmatter` loader (vite.config.ts) counts a lesson's questions with lessonChoiceIds and
// lessonCompilerErrorIds (plain parses); the lesson itself is compiled by @mdx-js with remarkCourse. If the two ever
// disagree on an id, that lesson can never be perfect. The plugin list is the one in vite.config.ts.
const root = join(process.cwd(), 'content/modules');
const lessons = readdirSync(root).flatMap(m => { try { return readdirSync(join(root, m, 'lessons')).filter(f => f.endsWith('.mdx')).map(f => join(root, m, 'lessons', f)); } catch { return []; } });

const plugins = [remarkFrontmatter, [remarkMdxFrontmatter, { name: 'frontmatter' }], remarkGfm, remarkCourse] as const;
async function compiledIds(mdx: string, attr: string, path = 'lesson.mdx'): Promise<string[]> {
  const js = String(await compile({ value: mdx, path }, { remarkPlugins: [...plugins] as never }));
  return [...js.matchAll(new RegExp(`\\b${attr}: "([^"]+)"`, 'g'))].map(m => m[1]);
}
const compiledQids = (mdx: string, path?: string) => compiledIds(mdx, 'qid', path);
const compiledCeids = (mdx: string, path?: string) => compiledIds(mdx, 'ceid', path);
/** The exercise ids the loader's `<instance>:<kind>` question ids name, in order. Sessions keep their own colon. */
const loaderInstances = (mdx: string) => [...new Set(lessonCompilerErrorIds(mdx).map(qid => qid.replace(/:(line|kind|stage)$/, '')))];

/** The source text of each compiled `<CompilerError …>` props object, in document order. */
function compiledCompilerErrorProps(js: string): string[] {
  // A component with several children compiles as _jsxs(CompilerError, {…}); a single one as _jsx(…).
  const marker = /_jsxs?\(CompilerError,\s*\{/g;
  const out: string[] = [];
  for (let m = marker.exec(js); m; m = marker.exec(js)) {
    const start = m.index + m[0].length - 1; // the opening brace
    let depth = 0, quote = '';
    for (let i = start; i < js.length; i++) {
      const ch = js[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { out.push(js.slice(start, i + 1)); break; }
    }
  }
  return out;
}

/** The props at the top level of a compiled props object (a second component nested as a child stays one value). */
function topLevelProps(objectText: string): Record<string, string> {
  const body = objectText.slice(1, -1);
  const parts: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  const props: Record<string, string> = {};
  for (const part of parts) {
    const m = /^\s*([A-Za-z_$][\w$]*):\s*([\s\S]*?)\s*$/.exec(part);
    if (m) props[m[1]] = m[2];
  }
  return props;
}

/** A compiled string literal. Any other expression is a prop the loader cannot count statically: fail loudly. */
function compiledString(prop: string | undefined, name: string): string | undefined {
  if (prop === undefined) return undefined;
  // Babel keeps the author's quote style: "link", 'link' and `link` all arrive here.
  const m = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)$/.exec(prop);
  if (!m) {
    throw new Error(`<CompilerError ${name}={…}> must be a string literal so the ?frontmatter loader can count its questions (found \`${prop}\`)`);
  }
  return (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1');
}

/** Each compiled `<CompilerError>`'s props that decide its questions, in document order. */
async function compiledCompilerErrors(mdx: string, path?: string): Promise<Array<{ ceid?: string; stage?: string }>> {
  const js = String(await compile({ value: mdx, path }, { remarkPlugins: [...plugins] as never }));
  return compiledCompilerErrorProps(js).map(text => {
    const props = topLevelProps(text);
    return { ceid: compiledString(props.ceid, 'ceid'), stage: compiledString(props.stage, 'stage') };
  });
}

/** The full `<instance>:<kind>` list the compiled components ask given their props. */
function questionsAsked(reports: Array<{ ceid?: string; stage?: string }>): string[] {
  return reports.flatMap(r => {
    if (!r.ceid) return [];
    const ceid = r.ceid;
    return compilerErrorQuestions(r.stage).map(q => compilerErrorQid(ceid, q));
  });
}

describe('lesson qids: the compiled lesson and the ?frontmatter loader agree', () => {
  it('finds the lessons and their questions', () => {
    expect(lessons.length).toBeGreaterThan(10);
    expect(lessons.reduce((n, f) => n + lessonChoiceIds(readFileSync(f, 'utf8')).length, 0)).toBeGreaterThan(10);
    expect(lessons.reduce((n, f) => n + lessonCompilerErrorIds(readFileSync(f, 'utf8')).length, 0)).toBeGreaterThan(0);
  });
  it.each(lessons.map(f => [f.slice(root.length + 1), f]))('%s', async (_name, file) => {
    const mdx = readFileSync(file, 'utf8');
    expect(await compiledQids(mdx, file)).toEqual(lessonChoiceIds(mdx));
    // The loader counts a question the component has no id for, or the reverse: the lesson could never be perfect.
    const reports = await compiledCompilerErrors(mdx, file);
    expect(reports.map(r => r.ceid).filter((id): id is string => id !== undefined)).toEqual(loaderInstances(mdx));
    // The full list, kinds included: a `stage` prop the loader reads as absent would count a line the component
    // never asks (the lesson could never be perfect).
    expect(questionsAsked(reports)).toEqual(lessonCompilerErrorIds(mdx));
  });
  it('a repeated question, a braced string and a C fence before the questions', async () => {
    const q = (question: string) => `<Choice\n  question=${question}\n  options={["a", "b"]}\n  answer={0}\n/>\n`;
    const mdx = `---\ntitle: T\n---\n\n# L\n\n\`\`\`c fragment\nint main(void) { return 0; }\n\`\`\`\n\n${q('"Same?"')}\n${q('{"Same?"}')}\n${q('"Other?"')}`;
    const ids = lessonChoiceIds(mdx);
    expect(ids).toHaveLength(3); expect(ids[1]).toBe(`${ids[0]}-2`);
    expect(await compiledQids(mdx)).toEqual(ids);
  });
  it('numbers a compiler-error exercise from its nested sample or session and asks the questions the loader counts', async () => {
    const fence = (id: string) => `\n\n\`\`\`c id=${id} predict=none expect=compile-error\nint main(void) { return 0; }\n\`\`\`\n`;
    const ce = (props: string, children = '') => `<CompilerError question="What is wrong?" options={["a", "b"]} answer={0}${props}>${children}</CompilerError>\n`;
    const mdx = `# L\n\n${ce('', fence('ce-one'))}\n${ce(' session="ld" stage="link"')}\n${ce(' session="ld" stage="link"')}`;
    expect(lessonCompilerErrorIds(mdx)).toEqual([
      'ce-one:line', 'ce-one:kind',
      'session:ld:kind', 'session:ld:stage',
      'session:ld-2:kind', 'session:ld-2:stage',
    ]);
    // The compiled element carries exactly the ids the loader counts (a lesson with another id could never be perfect).
    expect(await compiledCeids(mdx)).toEqual(['ce-one', 'session:ld', 'session:ld-2']);
    expect(questionsAsked(await compiledCompilerErrors(mdx))).toEqual(lessonCompilerErrorIds(mdx));
  });
  it('reads a braced string literal for `stage`, so both spellings ask the same questions', async () => {
    const ce = (session: string, stage: string) =>
      `<CompilerError question="What failed?" options={["a", "b"]} answer={0} session="${session}" stage=${stage} />\n`;
    // Every spelling compiles to the same prop; a loader that misses one would ask a line the component never shows.
    const mdx = `# L\n\n${ce('a', '"link"')}\n${ce('b', '{"link"}')}\n${ce('c', "{'link'}")}\n${ce('d', '{`link`}')}`;
    const expected = ['a', 'b', 'c', 'd'].flatMap(s => [`session:${s}:kind`, `session:${s}:stage`]);
    expect(lessonCompilerErrorIds(mdx)).toEqual(expected);
    const reports = await compiledCompilerErrors(mdx);
    expect(reports.map(r => r.stage)).toEqual(['link', 'link', 'link', 'link']);
    expect(questionsAsked(reports)).toEqual(expected);
  });
});
