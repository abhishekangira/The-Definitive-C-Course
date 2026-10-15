// remark plugin for lesson MDX:
//  1. ```c fences with id=… become <CodeSample id code meta/> (predict-before-run widgets);
//     ```c fragment fences become <CodeBlock/> (static); other fences stay as code.
//  2. Top-level content is wrapped into <Card index gated> groups (see src/content-model/cards.ts).
import type { Root, RootContent, Code } from 'mdast';
import { visit } from 'unist-util-visit';
import { parseRawMeta, toSampleMeta } from '../../src/content-model/fence-meta.ts';
import { groupCards } from '../../src/content-model/cards.ts';

type JsxAttr = { type: 'mdxJsxAttribute'; name: string; value: string | null };
const attr = (name: string, value: string): JsxAttr => ({ type: 'mdxJsxAttribute', name, value });

function jsx(name: string, attributes: JsxAttr[], children: RootContent[] = []): RootContent {
  return { type: 'mdxJsxFlowElement', name, attributes, children } as unknown as RootContent;
}

export default function remarkCourse() {
  return (tree: Root, file: { path?: string; message?: (m: string) => void }) => {
    visit(tree, 'code', (node: Code, index, parent) => {
      if (!parent || index === undefined) return;
      const lang = node.lang ?? '';
      if (lang !== 'c' && lang !== 'h') return;
      const meta = toSampleMeta(parseRawMeta(node.meta));
      if (!meta) {
        throw new Error(`${file.path ?? 'lesson'}: C fence at line ${node.position?.start.line} needs id=… or fragment`);
      }
      const replacement = meta.fragment
        ? jsx('CodeBlock', [attr('code', node.value), attr('lang', lang)])
        : jsx('CodeSample', [attr('id', meta.id), attr('code', node.value), attr('meta', JSON.stringify(meta))]);
      (parent.children as RootContent[])[index] = replacement;
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
