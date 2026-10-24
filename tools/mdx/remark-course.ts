// remark plugin for lesson MDX:
//  1. ```c fences with id=… become <CodeSample id code meta/> (predict-before-run widgets);
//     ```c fragment fences become <CodeBlock/> (static); other fences stay as code.
//  2. Each <Choice> gets qid="q<hash>", a hash of its question text (choiceIds), the key of its saved answer.
//  3. Each <CompilerError> gets ceid="<exercise id>", the prefix of its questions' saved first answers
//     (compilerErrorIds; content-model/compiler-error.ts derives the question kinds from `stage`).
//  4. Top-level content is wrapped into <Card index gated> groups (see src/content-model/cards.ts).
import type { Root, RootContent, Code } from 'mdast';
import { visit } from 'unist-util-visit';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { parseRawMeta, toSampleMeta } from '../../src/content-model/fence-meta.ts';
import { compilerErrorQid, compilerErrorQuestions } from '../../src/content-model/compiler-error.ts';
import { groupCards } from '../../src/content-model/cards.ts';
import type { SampleMeta } from '../../src/content-model/types.ts';

type EstreeExpression = { type: string; value?: unknown; expressions?: unknown[]; quasis?: Array<{ value: { cooked?: string | null } }> };
type AttrValue = string | null | { type: string; value: string; data?: { estree?: { body?: Array<{ type: string; expression?: EstreeExpression }> } } };
type JsxAttr = { type: 'mdxJsxAttribute'; name: string; value: AttrValue };
const attr = (name: string, value: string): JsxAttr => ({ type: 'mdxJsxAttribute', name, value });

function jsx(name: string, attributes: JsxAttr[], children: RootContent[] = []): RootContent {
  return { type: 'mdxJsxFlowElement', name, attributes, children } as unknown as RootContent;
}

/** What the plugin and the linter both need to know about a lowered fence, whatever meta parser was used. */
export interface ParsedFenceMeta { meta: SampleMeta | null }

export type FenceLowering<P extends ParsedFenceMeta = { meta: SampleMeta | null }> =
  | { ok: true; node: RootContent; meta: SampleMeta; parsed: P }
  | { ok: false; error: { rule: 'fence-meta' | 'fence-id'; message: string }; fallback: RootContent };

const defaultParse = (raw: string | null | undefined): ParsedFenceMeta => ({ meta: toSampleMeta(parseRawMeta(raw)) });

/**
 * The one place a ```c / ```h fence becomes a component: <CodeSample id code meta/> (id=…) or <CodeBlock/> (fragment).
 * Returns the replacement node, or a structured error plus the node to use instead. The remark plugin throws on an
 * error; tools/content-lint reports it. `parse` defaults to the app's meta parser; the linter passes the verifier's
 * (a superset that also reads warn=/expect.<target>=) and gets its result back as `parsed`.
 */
export function lowerCodeFence<P extends ParsedFenceMeta = { meta: SampleMeta | null }>(
  node: Code,
  parse: (raw: string | null | undefined) => P = defaultParse as unknown as (raw: string | null | undefined) => P,
): FenceLowering<P> {
  const lang = node.lang ?? '';
  const codeBlock = () => jsx('CodeBlock', [attr('code', node.value), attr('lang', lang)]);
  let parsed: P;
  try {
    parsed = parse(node.meta);
  } catch (e) {
    const err = e as Error;
    const message = err.name === 'SyntaxError'
      ? `a quoted fence value is not a valid JSON string (${err.message}); quoted values use JSON escapes such as \\n and \\"`
      : err.message;
    return { ok: false, error: { rule: 'fence-meta', message }, fallback: codeBlock() };
  }
  const meta = parsed.meta;
  if (!meta) {
    return {
      ok: false,
      error: { rule: 'fence-id', message: 'C fence needs id=… (a runnable, predict-before-run sample) or fragment (an illustration)' },
      fallback: codeBlock(),
    };
  }
  const replacement = meta.fragment
    ? codeBlock()
    : jsx('CodeSample', [attr('id', meta.id), attr('code', node.value), attr('meta', JSON.stringify(meta))]);
  return { ok: true, node: replacement, meta, parsed };
}

/** The lesson's <Choice> questions in document order. */
export function choiceNodes(tree: Root): Array<{ attributes: JsxAttr[] }> {
  const out: Array<{ attributes: JsxAttr[] }> = [];
  visit(tree, node => {
    const n = node as unknown as { type: string; name?: string; attributes?: JsxAttr[] };
    if ((n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') && n.name === 'Choice') out.push(n as { attributes: JsxAttr[] });
  });
  return out;
}

/** A string attribute value: the string itself, or a simple braced literal (`{"link"}`, `{'link'}`, `{`link`}`). */
function literalText(value: AttrValue | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return undefined;
  const e = value.data?.estree?.body?.[0]?.expression;
  if (e?.type === 'Literal' && typeof e.value === 'string') return e.value;
  if (e?.type === 'TemplateLiteral' && e.expressions?.length === 0 && e.quasis?.length === 1 && typeof e.quasis[0].value.cooked === 'string') return e.quasis[0].value.cooked;
  return undefined;
}

/** A `question` attribute's text: the string, or a string literal or plain template in braces; any other expression is its source. */
function questionText(node: { attributes: JsxAttr[] }): string {
  const value = node.attributes.find(x => x.name === 'question')?.value ?? null;
  const literal = literalText(value);
  if (literal !== undefined) return literal;
  return value !== null && typeof value !== 'string' ? value.value : '';
}

/** FNV-1a (32-bit) of the question with whitespace collapsed, as 8 hex digits. */
export function choiceId(question: string): string {
  let h = 0x811c9dc5;
  const text = question.trim().replace(/\s+/g, ' ');
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `q${h.toString(16).padStart(8, '0')}`;
}

/**
 * Each <Choice>'s `qid`, in document order: a hash of its question text, so adding, removing or reordering
 * questions does not move a saved answer onto another question (rewording a question makes it a new one).
 * The same question twice in one lesson gets `-2`, `-3`, … after its hash.
 */
export function choiceIds(tree: Root): string[] {
  const seen = new Map<string, number>();
  return choiceNodes(tree).map(n => {
    const id = choiceId(questionText(n));
    const k = (seen.get(id) ?? 0) + 1; seen.set(id, k);
    return k === 1 ? id : `${id}-${k}`;
  });
}

/** `choiceIds` of a lesson's MDX source, parsed (not compiled) the way the MDX plugin parses it. The `?frontmatter` loader and the e2e use it. */
export function lessonChoiceIds(mdx: string): string[] {
  return choiceIds(unified().use(remarkParse).use(remarkMdx).use(remarkFrontmatter).use(remarkGfm).parse(mdx.replace(/\r\n/g, '\n')) as Root);
}

type JsxNode = { type: string; name?: string; attributes?: JsxAttr[]; children?: RootContent[] };

/** The lesson's <CompilerError> exercises in document order. */
export function compilerErrorNodes(tree: Root): JsxNode[] {
  const out: JsxNode[] = [];
  visit(tree, node => {
    const n = node as unknown as JsxNode;
    if ((n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') && n.name === 'CompilerError') out.push(n);
  });
  return out;
}

/**
 * A string prop of a JSX node. A simple braced literal counts too: `stage={"link"}` is the same `stage` to the compiled
 * component, so the loader must read it (a mismatch would count questions the component never asks).
 */
function attrText(node: JsxNode, name: string): string | undefined {
  return literalText(node.attributes?.find(x => x.name === name)?.value);
}

/**
 * The id of the program a CompilerError shows: the nested fence's sample id, or `session:<id>`. In a parsed tree the
 * nested fence is still a `code` node; after lowerCodeFence it is a <CodeSample id>. Both shapes are read here, because
 * the `?frontmatter` loader parses and the plugin lowers.
 */
function compilerErrorInstance(node: JsxNode): string | undefined {
  const session = attrText(node, 'session');
  if (session) return `session:${session}`;
  for (const child of node.children ?? []) {
    const c = child as unknown as JsxNode;
    if (c.type === 'mdxJsxFlowElement' && c.name === 'CodeSample') return attrText(c, 'id');
    if (c.type === 'code') {
      const code = child as unknown as Code;
      if (code.lang !== 'c' && code.lang !== 'h') continue;
      try {
        const meta = toSampleMeta(parseRawMeta(code.meta));
        if (meta && !meta.fragment) return meta.id;
      } catch { /* a bad fence is content-lint's error; it has no stable id */ }
    }
  }
  return undefined;
}

/**
 * Each <CompilerError>'s stable id, in document order: the nested sample id, or `session:<session id>`. The same
 * exercise twice in a lesson gets `-2`, `-3`, … after its id (as choiceIds does), so two instances never share answers.
 */
export function compilerErrorIds(tree: Root): Array<string | undefined> {
  const seen = new Map<string, number>();
  return compilerErrorNodes(tree).map(n => {
    const id = compilerErrorInstance(n);
    if (!id) return undefined;
    const k = (seen.get(id) ?? 0) + 1; seen.set(id, k);
    return k === 1 ? id : `${id}-${k}`;
  });
}

/** Every compiler-error question the lesson asks, as `<instance>:<kind>` (the order the component asks them). */
export function compilerErrorQuestionIds(tree: Root): string[] {
  const ids = compilerErrorIds(tree);
  return compilerErrorNodes(tree).flatMap((n, i) => {
    const id = ids[i];
    return id ? compilerErrorQuestions(attrText(n, 'stage')).map(q => compilerErrorQid(id, q)) : [];
  });
}

/** `compilerErrorQuestionIds` of a lesson's MDX source, parsed (not compiled). The `?frontmatter` loader and e2e use it. */
export function lessonCompilerErrorIds(mdx: string): string[] {
  return compilerErrorQuestionIds(unified().use(remarkParse).use(remarkMdx).use(remarkFrontmatter).use(remarkGfm).parse(mdx.replace(/\r\n/g, '\n')) as Root);
}

export default function remarkCourse() {
  return (tree: Root, file: { path?: string; message?: (m: string) => void }) => {
    visit(tree, 'code', (node: Code, index, parent) => {
      if (!parent || index === undefined) return;
      const lang = node.lang ?? '';
      if (lang !== 'c' && lang !== 'h') return;
      const lowered = lowerCodeFence(node);
      if (!lowered.ok) {
        throw new Error(`${file.path ?? 'lesson'}: C fence at line ${node.position?.start.line}: ${lowered.error.message}`);
      }
      (parent.children as RootContent[])[index] = lowered.node;
    });

    const qids = choiceIds(tree);
    choiceNodes(tree).forEach((n, i) => { n.attributes = [...n.attributes.filter(a => a.name !== 'qid'), attr('qid', qids[i])]; });

    const ceids = compilerErrorIds(tree);
    compilerErrorNodes(tree).forEach((n, i) => {
      const id = ceids[i];
      n.attributes = [...(n.attributes ?? []).filter(a => a.name !== 'ceid'), ...(id ? [attr('ceid', id)] : [])];
    });

    const { hoisted, cards } = groupCards(tree);
    tree.children = [
      ...hoisted,
      ...cards.map((c, i) =>
        jsx('Card', [attr('index', String(i)), attr('gated', c.interaction ? 'true' : 'false'), attr('total', String(cards.length))], c.nodes),
      ),
    ];
  };
}
