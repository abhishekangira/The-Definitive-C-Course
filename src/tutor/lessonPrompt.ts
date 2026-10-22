// Pure prompt builder for the lesson chat (PLAN.md §2.6). No I/O.
//
// A model remembers nothing between requests, so every request carries the whole conversation: the instructions
// and the lesson first, then every earlier question and answer, then the new question. The lesson comes first and
// stays the same from turn to turn, which is also what lets a provider reuse its cached prefix.

import type { TutorMessage } from './prompt';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** The passage the learner highlighted when they asked (user turns only). */
  quote?: string;
}

/** How a turn is worded when the learner chose Explain. The words are what the model sees and what the transcript shows. */
export const EXPLAIN_REQUEST = 'Explain this.';

export const CHAT_CAP = {
  lesson: 60_000,
  quote: 3_000,
  content: 4_000,
  /** Messages kept from the conversation. The lesson is always sent; only old questions and answers fall off. */
  history: 12,
} as const;

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
}

const INSTRUCTIONS = [
  'You are the tutor for The Definitive C Course, an interactive course that teaches C17 to front-end engineers who know JavaScript.',
  'The learner is reading the lesson below and asks you about it. Answer from the lesson and from your knowledge of C, in plain words.',
  'Be brief: a short paragraph or a few bullets. Use Markdown only for `inline code`, short fenced code blocks, lists, bold and small tables. The chat panel is narrow: use a table only for a short comparison of at most 3 columns of a few words each, and a list otherwise.',
  'When the learner highlighted a passage, it is quoted in their message. For "Explain this.", say what the passage means and why it matters. Do not repeat it back.',
  'The lesson is shown in parts. Only the parts the learner has reached are included. Do not describe, hint at or reveal later parts.',
  'A video or animation in the lesson appears as its transcript (under "Transcript"), so you can answer questions about what it says. You cannot see its pictures.',
  'You cannot run code. Do not state what a program prints, returns or reports unless the lesson text shows that result; tell the learner to run it and compare.',
  'If the lesson is asking the learner a question, a prediction or an exercise, do not give the answer. Ask what they think, or point to the sentence that helps.',
  'Use a JavaScript comparison only when it helps, and say where it stops being true.',
  'If the question is not about C, programming or this lesson, say so in one sentence and offer to help with the lesson.',
  'If you are not sure, say "I\'m not sure".',
].join('\n');

export interface LessonChatInput {
  title: string;
  /** "Module 1", "Capstone". */
  moduleLabel: string;
  /** What `lessonTextFrom` read from the page when the learner asked. */
  lessonText: string;
  /** The whole conversation, ending with the question being asked now. */
  turns: readonly ChatTurn[];
}

function userContent(turn: ChatTurn): string {
  const text = cap(turn.content.trim(), CHAT_CAP.content);
  if (!turn.quote?.trim()) return text;
  return `The learner highlighted this passage in the lesson:\n"""\n${cap(turn.quote.trim(), CHAT_CAP.quote)}\n"""\n\n${text}`;
}

/**
 * The messages for one request: a system message with the instructions and the lesson, then the conversation.
 * The conversation keeps its last `CHAT_CAP.history` messages, starts with a user message, and merges
 * neighbours with the same role (a question that got no answer is followed by the next question).
 */
export function buildLessonMessages(input: LessonChatInput): TutorMessage[] {
  const system = [
    INSTRUCTIONS,
    '',
    `Lesson: ${cap(input.title, 300)} (${cap(input.moduleLabel, 100)})`,
    '',
    'The lesson text so far, as the learner sees it. It includes the learner\'s own edits to code samples and the transcripts of the videos and animations shown:',
    '<lesson>',
    cap(input.lessonText, CHAT_CAP.lesson),
    '</lesson>',
  ].join('\n');

  const messages: TutorMessage[] = [{ role: 'system', content: system }];
  const kept = input.turns.slice(-CHAT_CAP.history);
  for (const turn of kept) {
    const content = turn.role === 'user' ? userContent(turn) : cap(turn.content.trim(), CHAT_CAP.content);
    if (content === '') continue;
    const last = messages[messages.length - 1];
    if (last.role === turn.role) last.content = `${last.content}\n\n${content}`;
    else if (turn.role === 'user' || last.role !== 'system') messages.push({ role: turn.role, content });
    // An answer that opens the kept window has no question before it: drop it.
  }
  return messages;
}
