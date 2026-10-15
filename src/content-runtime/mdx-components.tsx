// Components available inside lesson and project MDX (no imports needed in content files).
import type { ComponentProps, ReactNode } from 'react';
import { Card } from '../lesson/LessonContext';
import { CodeSample } from '../interactions/CodeSample';
import { Choice } from '../interactions/Choice';
import { CompilerError } from '../interactions/CompilerError';
import { MemoryDiagram } from '../interactions/MemoryDiagram';
import { NumberDrill } from '../interactions/NumberDrill';
import { Exercise } from '../interactions/Exercise';
import { Stepper } from '../visualizers/Stepper';
import { NumberPlayground } from '../visualizers/NumberPlayground';
import { PipelineExplorer } from '../visualizers/PipelineExplorer';
import { Analogy, Callout, CodeBlock } from '../components/Content';
import { Explainer } from '../components/Explainer';
import { YouTube } from '../components/YouTube';
import { TestExample } from '../components/TestExample';

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
