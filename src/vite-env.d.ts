/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth client id for Google Drive sync (src/progress/drive.ts). Unset: the feature is hidden. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

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
