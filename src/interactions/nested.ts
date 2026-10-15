import { Children, isValidElement, type ReactNode } from 'react';
import type { SampleMeta } from '../content-model/types';

export interface NestedSample { id: string; code: string; meta: SampleMeta }

/** Interactions can wrap ```c fences; the remark plugin turned each into <CodeSample id code meta/>. */
export function nestedSamples(children: ReactNode): NestedSample[] {
  const out: NestedSample[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue;
    const p = child.props as { id?: string; code?: string; meta?: string; children?: ReactNode };
    if (p.id && typeof p.code === 'string' && typeof p.meta === 'string') out.push({ id: p.id, code: p.code, meta: JSON.parse(p.meta) as SampleMeta });
    else out.push(...nestedSamples(p.children));
  }
  return out;
}

export function nestedSample(children: ReactNode): NestedSample | null {
  return nestedSamples(children)[0] ?? null;
}
