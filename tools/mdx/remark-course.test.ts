import { describe, expect, it } from 'vitest';
import { choiceId, lessonChoiceIds } from './remark-course';

const q = (question: string, answer = 0) => `<Choice\n  question=${question}\n  options={["a", "b"]}\n  answer={${answer}}\n/>\n`;

describe('choiceIds: a quiz question\'s qid is a hash of its text, not its place', () => {
  it('keeps each question\'s id when one is added before it or the order changes', () => {
    const [a, b] = lessonChoiceIds(`# L\n\n${q('"First?"')}\n${q('"Second?"')}`);
    expect(a).toMatch(/^q[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(lessonChoiceIds(`# L\n\n${q('"New?"')}\n${q('"Second?"')}\n${q('"First?"')}`).slice(1)).toEqual([b, a]);
    // The answer, options and surrounding prose do not change the id; the question text does.
    expect(lessonChoiceIds(`Intro.\n\n${q('"First?"', 1)}`)).toEqual([a]);
    expect(lessonChoiceIds(q('"First? "'))).toEqual([a]);
    expect(lessonChoiceIds(q('"First question?"'))).not.toEqual([a]);
  });
  it('reads a string in braces like a plain string; another expression hashes its source', () => {
    const [plain] = lessonChoiceIds(q(`'Which "value" matches?'`));
    expect(lessonChoiceIds(q(`{'Which "value" matches?'}`))).toEqual([plain]);
    expect(lessonChoiceIds(q('{`Which "value" matches?`}'))).toEqual([plain]);
    expect(plain).toBe(choiceId('Which "value" matches?'));
    expect(lessonChoiceIds(q('{"a" + "b"}'))).toEqual([choiceId('"a" + "b"')]);
  });
  it('numbers a repeated question in one lesson', () => {
    const [x, y, z] = lessonChoiceIds(`${q('"Same?"')}\n${q('"Same?"')}\n${q('"Other?"')}`);
    expect(y).toBe(`${x}-2`);
    expect(z).not.toBe(x);
  });
});
