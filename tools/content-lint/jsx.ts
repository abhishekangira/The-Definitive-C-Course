// Helpers for reading MDX JSX elements (mdast-util-mdx-jsx nodes) and their attribute values.
// Attributes are either string literals (`id="x"`) or expressions (`options={["a", "b"]}`); the expressions
// authors write in lessons are plain literals, so they are evaluated from the ESTree acorn attached.
import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';

/** Marks an expression we cannot evaluate statically (a variable, a call, ...). */
export const UNKNOWN = Symbol('unknown');
export type Literal = string | number | boolean | null | Literal[] | typeof UNKNOWN;

interface Estree { type: string; [k: string]: unknown }

export interface JsxAttribute {
  type: 'mdxJsxAttribute' | 'mdxJsxExpressionAttribute';
  name?: string;
  value?: string | { type: 'mdxJsxAttributeValueExpression'; value: string; data?: { estree?: Estree | null } } | null;
}

export interface JsxNode {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name: string | null;
  attributes: JsxAttribute[];
  children: unknown[];
  position?: { start: { line: number; column: number }; end: { line: number; column: number } };
  /** Set on the nodes content-lint creates in place of ```c fences. */
  data?: { lowered?: boolean; sample?: unknown };
}

export function isJsx(node: unknown): node is JsxNode {
  const t = (node as { type?: string } | null)?.type;
  return t === 'mdxJsxFlowElement' || t === 'mdxJsxTextElement';
}

/** Evaluates a literal-only ESTree expression (strings, numbers, arrays, `"a" + "b"`, `-1`, templates). */
export function evalEstree(node: Estree | null | undefined): Literal {
  if (!node) return UNKNOWN;
  switch (node.type) {
    case 'Program': {
      const body = node.body as Estree[];
      return body.length === 1 && body[0].type === 'ExpressionStatement' ? evalEstree(body[0].expression as Estree) : UNKNOWN;
    }
    case 'Literal': {
      const v = node.value;
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null ? v : UNKNOWN;
    }
    case 'TemplateLiteral': {
      const quasis = node.quasis as Array<{ value: { cooked: string | null } }>;
      return (node.expressions as unknown[]).length === 0 && quasis.length === 1 && quasis[0].value.cooked !== null ? quasis[0].value.cooked : UNKNOWN;
    }
    case 'ArrayExpression': {
      const out: Literal[] = [];
      for (const el of node.elements as Array<Estree | null>) {
        const v = el ? evalEstree(el) : UNKNOWN;
        if (v === UNKNOWN) return UNKNOWN;
        out.push(v);
      }
      return out;
    }
    case 'UnaryExpression': {
      const v = evalEstree(node.argument as Estree);
      if (typeof v !== 'number') return UNKNOWN;
      return node.operator === '-' ? -v : node.operator === '+' ? v : UNKNOWN;
    }
    case 'BinaryExpression': {
      if (node.operator !== '+') return UNKNOWN;
      const l = evalEstree(node.left as Estree);
      const r = evalEstree(node.right as Estree);
      return typeof l === 'string' && typeof r === 'string' ? l + r : UNKNOWN;
    }
    default:
      return UNKNOWN;
  }
}

export interface AttrValue {
  present: boolean;
  /** The value when it is statically known (UNKNOWN for an expression we could not evaluate). */
  value: Literal | undefined;
}

/** Reads attribute `name`. Boolean attributes (`<X flag />`) evaluate to true. */
export function attr(node: JsxNode, name: string): AttrValue {
  const a = node.attributes.find(x => x.type === 'mdxJsxAttribute' && x.name === name);
  if (!a) return { present: false, value: undefined };
  if (a.value === null || a.value === undefined) return { present: true, value: true };
  if (typeof a.value === 'string') return { present: true, value: a.value };
  return { present: true, value: evalEstree(a.value.data?.estree) };
}

/** True when the element spreads props (`{...props}`): its attributes cannot be checked completely. */
export function hasSpread(node: JsxNode): boolean {
  return node.attributes.some(a => a.type === 'mdxJsxExpressionAttribute');
}

export const line = (node: { position?: { start: { line: number } } } | undefined | null): number => node?.position?.start.line ?? 0;

/** Every JSX element under `root` (flow and text), with its ancestors. */
export function jsxElements(root: unknown): Array<{ node: JsxNode; ancestors: unknown[] }> {
  const out: Array<{ node: JsxNode; ancestors: unknown[] }> = [];
  visit(root as Root, (node, _index, parent) => {
    if (isJsx(node)) out.push({ node, ancestors: parent ? [parent] : [] });
  });
  return out;
}

/** Nested ```c samples (the CodeSample nodes content-lint put in place of fences) below an element. */
export function nestedLowered(node: JsxNode): JsxNode[] {
  const out: JsxNode[] = [];
  const walk = (children: unknown[]) => {
    for (const c of children) {
      if (isJsx(c) && c.data?.lowered && c.name === 'CodeSample') out.push(c);
      else if ((c as { children?: unknown[] }).children) walk((c as { children: unknown[] }).children);
    }
  };
  walk(node.children);
  return out;
}
