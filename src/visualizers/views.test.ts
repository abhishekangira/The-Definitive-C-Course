// @vitest-environment jsdom
// Behaviour of the new V1 views and the float drill, mounted for real (react-dom + jsdom). The expected values
// come from numbers.test.ts's C-checked helpers or from the arithmetic the lesson teaches (3 presses from 253).
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NumberDrill } from '../interactions/NumberDrill';
import { NumberPlayground } from './NumberPlayground';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (el: Parameters<Root['render']>[0]) => act(() => root.render(el));
const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name)!;
const click = (name: string) => act(() => { button(name).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const read = (key: string) => host.querySelector(`[data-read="${key}"]`)!.textContent;
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const submit = () => act(() => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });

describe('NumberPlayground mode="wheel"', () => {
  it('wraps: three Add 1 presses from 253 show 0, and Subtract 1 wraps back to 255', () => {
    render(createElement(NumberPlayground, { mode: 'wheel', value: 253, width: 8 }));
    expect(read('unsigned')).toBe('253');
    expect(read('signed')).toBe('-3');
    click('Add 1'); click('Add 1');
    expect(read('unsigned')).toBe('255');
    click('Add 1');
    expect(read('unsigned')).toBe('0');
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Unsigned wrapped: 255 + 1 is 0');
    click('Subtract 1');
    expect(read('unsigned')).toBe('255');
    expect(read('signed')).toBe('-1');
  });
  it('reads 127 + 1 as -128 when signed, with a note about the sign bit, and has a text alternative', () => {
    render(createElement(NumberPlayground, { mode: 'wheel', value: 127, width: 8 }));
    click('Add 1');
    expect(read('signed')).toBe('-128');
    expect(host.querySelector('[role="status"]')!.textContent).toContain('sign bit changed');
    expect(host.querySelector('svg')!.getAttribute('aria-label')).toContain('128 as an unsigned number, -128 as a signed number');
    click('Reset');
    expect(read('unsigned')).toBe('127');
  });
});

describe('NumberPlayground mode="float"', () => {
  it('decodes 1.0f, flips the sign bit to get -1, and reports the class', () => {
    render(createElement(NumberPlayground, { mode: 'float', value: 1, width: 32 }));
    expect(read('hex')).toBe('0x3F800000');
    expect(read('value')).toBe('1');
    click('sign bit 0: 0');
    expect(read('value')).toBe('-1');
    expect(read('hex')).toBe('0xBF800000');
    expect(read('class')).toBe('normal');
  });
  it('rounds a typed 0.1 to the nearest float and says so', () => {
    render(createElement(NumberPlayground, { mode: 'float', value: 1, width: 32 }));
    type(host.querySelector('input')!, '0.1');
    expect(read('hex')).toBe('0x3DCCCCCD');
    expect(host.textContent).toContain('A float cannot hold 0.1 exactly');
  });
  it('shows the JavaScript Number line in 64-bit mode only', () => {
    render(createElement(NumberPlayground, { mode: 'float', value: 0.1 + 0.2, width: 64 }));
    expect(read('js')).toBe('0.30000000000000004');
    render(createElement(NumberPlayground, { key: 'f32', mode: 'float', value: 1, width: 32 }));
    expect(host.querySelector('[data-read="js"]')).toBeNull();
  });
  it('infinity and NaN classes come from the exponent field all ones', () => {
    render(createElement(NumberPlayground, { mode: 'float', value: Infinity, width: 32 }));
    expect(read('class')).toBe('infinity');
    expect(read('value')).toBe('Infinity');
    render(createElement(NumberPlayground, { key: 'nan', mode: 'float', value: NaN, width: 32 }));
    expect(read('class')).toBe('NaN (not a number)');
  });
});

describe('NumberPlayground mode="int" is unchanged', () => {
  it('still toggles bits and shows the signed and unsigned readings', () => {
    render(createElement(NumberPlayground, { value: 255, width: 8, signed: true }));
    expect(host.textContent).toContain('1111 1111');
    expect(host.textContent).toContain('-1');
  });
});

describe('NumberDrill kind="float"', () => {
  it('decodes 0x3F800000: "1" is right, "2" is wrong and the correction is shown', () => {
    render(createElement(NumberDrill, { kind: 'float', value: '0x3F800000', from: 'hex', to: 'dec' }));
    type(host.querySelector('input')!, '2');
    submit();
    expect(host.textContent).toContain("It's 1.");
    type(host.querySelector('input')!, '1.0');
    submit();
    expect(host.textContent).toContain('Correct.');
  });
  it('encodes -2.5: 0xC0200000 is right, with or without the 0x', () => {
    render(createElement(NumberDrill, { kind: 'float', value: -2.5, from: 'dec', to: 'hex' }));
    type(host.querySelector('input')!, 'c0200000');
    submit();
    expect(host.textContent).toContain('Correct.');
    type(host.querySelector('input')!, '0x3F800000');
    submit();
    expect(host.textContent).toContain("It's 0xC0200000.");
  });
  it('leaves the integer drill alone', () => {
    render(createElement(NumberDrill, { value: 13, from: 'dec', to: 'bin', width: 8 }));
    type(host.querySelector('input')!, '00001101');
    submit();
    expect(host.textContent).toContain('Correct.');
  });
});

describe('ByteViewer', () => {
  it('shows 0x12345678 least significant byte first, and flips with the big-endian switch', async () => {
    const { ByteViewer } = await import('./ByteViewer');
    render(createElement(ByteViewer, { value: 0x12345678, width: 32 }));
    expect(read('bytes')).toBe('78 56 34 12');
    expect(read('ascii')).toBe('xV4.');
    expect(host.querySelector('[data-byte="78"]')!.textContent).toContain('least significant');
    click('Big-endian');
    expect(read('bytes')).toBe('12 34 56 78');
    expect(button('Big-endian').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-byte="78"]')!.textContent).toContain('least significant');
  });
  it('re-reads a typed value at a new width', async () => {
    const { ByteViewer } = await import('./ByteViewer');
    render(createElement(ByteViewer, { key: 'w', value: 258, width: 16 }));
    expect(read('bytes')).toBe('02 01');
    type(host.querySelector('input')!, '0x4142');
    expect(read('bytes')).toBe('42 41');
    expect(read('ascii')).toBe('BA');
  });
  it('UTF-8 mode: the euro sign is three bytes, and a typed code point changes them', async () => {
    const { ByteViewer } = await import('./ByteViewer');
    render(createElement(ByteViewer, { key: 'u', mode: 'utf8', text: '€' }));
    expect(read('codepoint')).toBe('U+20AC');
    expect(read('count')).toBe('3');
    expect(read('bytes')).toBe('E2 82 AC');
    type(host.querySelector('input')!, 'A');
    expect(read('bytes')).toBe('41');
    type(host.querySelector('input')!, 'U+D800');
    expect(host.textContent).toContain('not a character UTF-8 can encode');
  });
});
