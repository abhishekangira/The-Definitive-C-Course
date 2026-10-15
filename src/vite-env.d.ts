/// <reference types="vite/client" />

declare module '*.yaml' {
  const value: unknown;
  export default value;
}

declare module '*.mdx' {
  import type { ComponentType } from 'react';
  import type { LessonFrontmatter } from './content-model/types';
  export const frontmatter: LessonFrontmatter;
  const Component: ComponentType<{ components?: Record<string, unknown> }>;
  export default Component;
}

declare module '*.c?raw' {
  const src: string;
  export default src;
}
declare module '*.h?raw' {
  const src: string;
  export default src;
}
