// remark plugin for lesson MDX:
//  1. ```c fences with id=… become <CodeSample id code meta/> (predict-before-run widgets);
//     ```c fragment fences become <CodeBlock/> (static); other fences stay as code.
//  2. Top-level content is wrapped into <Card index gated> groups (see src/content-model/cards.ts).
import type { Root, RootContent, Code } from 'mdast';
import { visit } from 'unist-util-visit';
import { parseRawMeta, toSampleMeta } from '../../src/content-model/fence-meta';
import { groupCards } from '../../src/content-model/cards';
import type { SampleMeta } from '../../src/content-model/types';

type JsxAttr = { type: 'mdxJsxAttribute'; name: string; value: string | null };
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

    const { hoisted, cards } = groupCards(tree);
    tree.children = [
      ...hoisted,
      ...cards.map((c, i) =>
        jsx('Card', [attr('index', String(i)), attr('gated', c.interaction ? 'true' : 'false'), attr('total', String(cards.length))], c.nodes),
      ),
    ];
  };
}
