import { describe, expect, it } from 'vitest';
import { buildLessonMessages, CHAT_CAP, EXPLAIN_REQUEST, type ChatTurn } from './lessonPrompt';

const base = { title: 'Hello, compiled world', moduleLabel: 'Module 1', lessonText: '--- Part 1 of 3 ---\nA C program is compiled first.' };

describe('buildLessonMessages', () => {
  it('opens with one system message holding the instructions and the lesson, then the question', () => {
    const messages = buildLessonMessages({ ...base, turns: [{ role: 'user', content: 'what is a compiler?' }] });
    expect(messages.map(m => m.role)).toEqual(['system', 'user']);
    expect(messages[0].content).toContain('Hello, compiled world (Module 1)');
    expect(messages[0].content).toContain('<lesson>\n--- Part 1 of 3 ---\nA C program is compiled first.\n</lesson>');
    expect(messages[1].content).toBe('what is a compiler?');
  });

  it('quotes the highlighted passage in the question, and the Explain request is plain words', () => {
    const [, user] = buildLessonMessages({ ...base, turns: [{ role: 'user', content: EXPLAIN_REQUEST, quote: 'return 0;' }] });
    expect(user.content).toBe(`The learner highlighted this passage in the lesson:\n"""\nreturn 0;\n"""\n\n${EXPLAIN_REQUEST}`);
  });

  it('sends the whole conversation and the same lesson on every turn, because the model remembers nothing', () => {
    const turns: ChatTurn[] = [{ role: 'user', content: 'q1' }];
    const first = buildLessonMessages({ ...base, turns });
    turns.push({ role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2', quote: 'passage' });
    const second = buildLessonMessages({ ...base, turns });
    expect(second.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(second[0]).toEqual(first[0]);
    expect(second[1]).toEqual(first[1]);
    expect(second[2].content).toBe('a1');
    expect(second[3].content).toContain('passage');
  });

  it('tells the model not to reveal later parts, answers to what the lesson asks, or output it cannot know', () => {
    const [system] = buildLessonMessages({ ...base, turns: [] });
    expect(system.content).toContain('Do not describe, hint at or reveal later parts.');
    expect(system.content).toContain('do not give the answer');
    expect(system.content).toContain('You cannot run code.');
    expect(system.content).toContain('appears as its transcript');
  });

  it('keeps the last messages, starts with a question, and merges a question that got no answer into the next', () => {
    const turns: ChatTurn[] = [];
    for (let i = 0; i < 10; i++) turns.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: `a${i}` });
    turns.push({ role: 'user', content: 'lost' }, { role: 'assistant', content: '' }, { role: 'user', content: 'again' });
    const messages = buildLessonMessages({ ...base, turns });
    expect(messages.length).toBeLessThanOrEqual(1 + CHAT_CAP.history);
    expect(messages[1].role).toBe('user');
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'lost\n\nagain' });
    for (let i = 2; i < messages.length; i++) expect(messages[i].role, `no two ${messages[i].role} messages in a row`).not.toBe(messages[i - 1].role);
  });

  it('caps the lesson, the quote and every message', () => {
    const [system, user] = buildLessonMessages({
      ...base, lessonText: 'x'.repeat(CHAT_CAP.lesson * 2),
      turns: [{ role: 'user', content: 'y'.repeat(CHAT_CAP.content * 3), quote: 'z'.repeat(CHAT_CAP.quote * 3) }],
    });
    expect(system.content.length).toBeLessThan(CHAT_CAP.lesson + 3_000);
    expect(user.content.length).toBeLessThan(CHAT_CAP.content + CHAT_CAP.quote + 300);
  });
});
