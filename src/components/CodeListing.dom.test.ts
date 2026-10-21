// @vitest-environment jsdom
// <CodeListing> sizes its number column for its longest number (jsdom has no layout; e2e/code-listing.spec.ts measures the
// x positions in Chromium). The program is the add-frames trace's source; the long listing stands in for PipelineExplorer's
// preprocessed output, which it caps at 1500 lines.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { TraceFile } from '../content-model/types';
import { CodeListing } from './CodeListing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const add = JSON.parse(readFileSync(path.join(process.cwd(), 'src/generated/traces/add-frames.json'), 'utf8')) as TraceFile;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const digitsFor = (code: string) => {
  act(() => root.render(createElement(CodeListing, { code, label: 'Program' })));
  const ol = host.querySelector('ol')!;
  return [ol.style.getPropertyValue('--digits'), ol.dataset.digits];
};

it('gives the number column room for at least three digits, and for four once a listing passes 999 lines', () => {
  expect(digitsFor(add.source)).toEqual(['3', '3']);
  expect(digitsFor(Array.from({ length: 1500 }, (_, i) => `# ${i + 1} "<stdin>"`).join('\n'))).toEqual(['4', '4']);
});
