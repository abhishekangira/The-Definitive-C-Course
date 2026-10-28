// @vitest-environment jsdom
// The V7 tab set: lesson 1.1's <PipelineExplorer> with no props must stay exactly the three tabs it shipped with, and
// the MDX `stages` attribute is the only way to add the object, nm and link views.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PipelineExplorer } from './PipelineExplorer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const code = 'int main(void) {\n    return 0;\n}\n';
const render = (props: { code: string; stages?: string }) => act(() => root.render(createElement(PipelineExplorer, props)));
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map(t => t.textContent);

describe('<PipelineExplorer> tabs', () => {
  it('renders exactly the three lesson-1.1 tabs without a stages prop', () => {
    render({ code });
    expect(tabs()).toEqual(['1. Your source', '2. After the preprocessor', '3. Assembly (WebAssembly)']);
  });

  it('adds the object, nm and link tabs when the MDX asks for them, in the author’s order', () => {
    render({ code, stages: 'source,E,S,objdump-t,objdump-d,nm,link' });
    expect(tabs()).toEqual([
      '1. Your source', '2. After the preprocessor', '3. Assembly (WebAssembly)',
      '4. Object file: symbols', '5. Object file: instructions', '6. nm: defined and undefined', '7. Link',
    ]);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('1. Your source');
  });

  it('keeps the source tab first and drops names it does not know', () => {
    render({ code, stages: 'E,no-such-tab,source,nm' });
    expect(tabs()).toEqual(['1. Your source', '2. After the preprocessor', '6. nm: defined and undefined']);
  });
});
