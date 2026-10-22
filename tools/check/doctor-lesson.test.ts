// Lesson 3.1 asks which "my machine" value fits an Apple-chip Mac whose Node runs under Rosetta. The answer is a
// fact about the doctor, so it is checked against the doctor's own mapping (machineFor) and the labels the
// <PlatformPicker /> shows: change either the lesson's answer or the mapping and this fails.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';
import { PLATFORM_LABEL } from '../../src/interactions/platform';
import type { Platform } from '../../src/progress/store';
import { assess, machineFor, type DoctorFacts } from './src/doctor';

const LESSON = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../content/modules/m03-going-native/lessons/01-install-and-doctor.mdx');

type Jsx = { type: string; name?: string; attributes: Array<{ name: string; value: string | { value: string } | null }> };
/** The first <Choice> after <PlatformPicker />, with its props evaluated. */
function choiceAfterPicker(): { question: string; options: string[]; answer: number } {
  const tree = unified().use(remarkParse).use(remarkMdx).parse(readFileSync(LESSON, 'utf8').replace(/^---[\s\S]*?---\n/, ''));
  const elements: Jsx[] = [];
  visit(tree, 'mdxJsxFlowElement', (n: unknown) => { elements.push(n as Jsx); });
  const picker = elements.findIndex(e => e.name === 'PlatformPicker');
  expect(picker, '<PlatformPicker /> is in lesson 3.1').toBeGreaterThanOrEqual(0);
  const choice = elements.slice(picker + 1).find(e => e.name === 'Choice');
  expect(choice, 'a <Choice> follows <PlatformPicker />').toBeDefined();
  const prop = (name: string): unknown => {
    const v = choice!.attributes.find(a => a.name === name)?.value;
    return typeof v === 'string' ? v : v ? new Function(`return (${v.value});`)() : undefined;
  };
  return { question: String(prop('question')), options: prop('options') as string[], answer: prop('answer') as number };
}

describe('lesson 3.1: the "my machine" question after <PlatformPicker />', () => {
  // The question's case: an Apple-chip Mac, Terminal or Node under Rosetta (Node reports x64, uname -m x86_64).
  const rosetta: DoctorFacts = {
    platform: 'darwin', nodeArch: 'x64', nodeVersion: '22.0.0', machine: 'x86_64', appleSilicon: true, translated: true, wsl: false,
    tools: { gdb: false, lldb: true, valgrind: false, leaks: true }, sizes: {},
  } as DoctorFacts;

  it('the question describes the case the test feeds the doctor', () => {
    const q = choiceAfterPicker().question;
    for (const words of ['Apple chip', 'x64', 'Rosetta']) expect(q).toContain(words);
    expect(assess(rosetta).findings.some(f => f.level === 'warning' && /Rosetta/.test(f.text)), 'the doctor warns about Rosetta').toBe(true);
  });

  it("the lesson's answer is the doctor's value, and every distractor is another PlatformPicker label", () => {
    const { options, answer } = choiceAfterPicker();
    const want = machineFor(rosetta);
    expect(want).toBeDefined();
    expect(assess(rosetta).machine).toBe(want);
    expect(options[answer]).toBe(PLATFORM_LABEL[want!]);
    const others = new Set(Object.entries(PLATFORM_LABEL).filter(([k]) => k !== want).map(([, label]) => label));
    const distractors = options.filter((_, i) => i !== answer);
    expect(distractors.length).toBeGreaterThanOrEqual(2);
    for (const d of distractors) expect(others.has(d), `"${d}" is the label of another Platform`).toBe(true);
    expect(new Set(options).size).toBe(options.length);
  });

  it('the mapping it relies on: every Platform is reachable from some facts', () => {
    const base = { nodeVersion: '22.0.0', wsl: false } as const;
    const got: Array<Platform | undefined> = [
      machineFor({ ...base, platform: 'darwin', nodeArch: 'arm64', appleSilicon: true }),
      machineFor({ ...base, platform: 'darwin', nodeArch: 'x64', appleSilicon: false }),
      machineFor({ ...base, platform: 'linux', nodeArch: 'x64', machine: 'x86_64', wsl: true }),
      machineFor({ ...base, platform: 'linux', nodeArch: 'x64', machine: 'x86_64' }),
      machineFor({ ...base, platform: 'linux', nodeArch: 'arm64', machine: 'aarch64' }),
    ];
    expect(got).toEqual(Object.keys(PLATFORM_LABEL));
  });
});
