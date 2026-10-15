// Components available inside lesson and project MDX (no imports needed in content files).
import { lazy, Suspense, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { Card } from '../lesson/LessonContext';
import { CodeSample } from '../interactions/CodeSample';
import { Choice } from '../interactions/Choice';
import { CompilerError } from '../interactions/CompilerError';
import { NumberDrill } from '../interactions/NumberDrill';
import { Analogy, Callout, CodeBlock } from '../components/Content';
import { Explainer } from '../components/Explainer';
import { YouTube } from '../components/YouTube';
import { TestExample } from '../components/TestExample';

/**
 * The heavy interactions (the code-exercise runner with its Parsons and download code, the stepper, the pipeline
 * explorer, the number playground, the memory diagram) are separate chunks, fetched when a lesson first renders
 * one. Until then a reserved, announced placeholder holds their place, so the card does not jump.
 */
function lazyInteraction<P extends object>(load: () => Promise<ComponentType<P>>, what: string): ComponentType<P> {
  const Inner = lazy(async () => ({ default: await load() })) as unknown as ComponentType<object>;
  return function LazyInteraction(props: P) {
    return (
      <Suspense fallback={<div role="status" aria-busy="true" style={{ minHeight: '10rem', padding: 'var(--space-4, 1rem)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>Loading {what}…</div>}>
        <Inner {...props} />
      </Suspense>
    );
  };
}

const MemoryDiagram = lazyInteraction(async () => (await import('../interactions/MemoryDiagram')).MemoryDiagram, 'memory diagram');
const Exercise = lazyInteraction(async () => (await import('../interactions/Exercise')).Exercise, 'exercise');
const Stepper = lazyInteraction(async () => (await import('../visualizers/Stepper')).Stepper, 'stepper');
const NumberPlayground = lazyInteraction(async () => (await import('../visualizers/NumberPlayground')).NumberPlayground, 'number playground');
const PipelineExplorer = lazyInteraction(async () => (await import('../visualizers/PipelineExplorer')).PipelineExplorer, 'pipeline explorer');

function Table(props: ComponentProps<'table'>) {
  return <div style={{ overflowX: 'auto' }}><table {...props} /></div>;
}

export const mdxComponents = {
  Card,
  CodeSample,
  CodeBlock,
  Choice,
  CompilerError,
  MemoryDiagram,
  NumberDrill,
  Exercise,
  Stepper,
  NumberPlayground,
  PipelineExplorer,
  Analogy,
  Callout,
  Animation: Explainer,
  YouTube,
  TestExample,
  table: Table,
  Kbd: ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>,
};
