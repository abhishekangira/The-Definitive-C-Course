// Splits a lesson's top-level mdast nodes into cards. A card is a run of content nodes that ends with
// exactly one interaction. Used by the remark plugin (rendering) and by content-lint (word budget),
// so the budget is checked exactly the way learners see the lesson.
import type { Root, RootContent } from 'mdast';

/** MDX elements that require a learner action. */
export const INTERACTIONS = new Set([
  'CodeSample', 'Exercise', 'Choice', 'MemoryDiagram', 'Stepper', 'CompilerError', 'NumberDrill',
  'TraceTable', 'LocalTask', 'Order',
]);
/** Elements that count as "one animation or video clip". */
export const MEDIA = new Set(['Animation', 'YouTube']);
/** Elements that are neither prose nor interaction (rendered as-is, zero words). */
export const NEUTRAL = new Set(['Analogy', 'CodeBlock', 'NumberPlayground', 'ByteViewer', 'PipelineExplorer', 'Callout', 'Figure', 'Transcript', 'PlatformPicker']);

export function elementName(node: RootContent): string | null {
  const n = node as { type: string; name?: string | null };
  return (n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') && n.name ? n.name : null;
}

export function isInteraction(node: RootContent): boolean {
  const name = elementName(node);
  return name !== null && INTERACTIONS.has(name);
}

export function isMedia(node: RootContent): boolean {
  const name = elementName(node);
  return name !== null && MEDIA.has(name);
}

/** Top-level nodes that must stay outside cards (ESM exports such as frontmatter). */
export function isHoisted(node: RootContent): boolean {
  return node.type === 'mdxjsEsm' || node.type === 'yaml' || (node as { type: string }).type === 'toml';
}

export interface CardGroup {
  nodes: RootContent[];
  interaction: RootContent | null;
}

export function groupCards(root: Root): { hoisted: RootContent[]; cards: CardGroup[] } {
  const hoisted: RootContent[] = [];
  const cards: CardGroup[] = [];
  let current: RootContent[] = [];
  for (const node of root.children) {
    if (isHoisted(node)) { hoisted.push(node); continue; }
    current.push(node);
    if (isInteraction(node)) { cards.push({ nodes: current, interaction: node }); current = []; }
  }
  if (current.length) cards.push({ nodes: current, interaction: null });
  return { hoisted, cards };
}

/** Counts prose words (paragraphs, headings, lists, blockquotes, tables, Analogy text props excluded). */
export function countWords(nodes: RootContent[]): number {
  let words = 0;
  const walk = (n: unknown): void => {
    const node = n as { type: string; value?: string; children?: unknown[] };
    if (node.type === 'code' || node.type === 'mdxJsxFlowElement' || node.type === 'mdxjsEsm' || node.type === 'html') return;
    if ((node.type === 'text' || node.type === 'inlineCode') && node.value) {
      words += node.value.split(/\s+/).filter(Boolean).length;
    }
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return words;
}
