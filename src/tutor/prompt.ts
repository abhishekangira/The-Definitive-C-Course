// Pure prompt builder for the tutor (PLAN.md §2.6). No I/O. The caller passes only the hints
// the learner has opened, and the real outputs from the check the app just ran.

export type TutorQuestion = 'nudge' | 'why';

export interface TutorFailureCase {
  name: string;
  /** How the program was run: command line and stdin. Empty when the check never ran it. */
  input: string;
  /** Expected text, or "" when this check is not an output comparison. */
  expected: string;
  /** The program's real output, or "" when it printed nothing. Never invent this. */
  actual: string;
  /** Plain-language failure, such as a compiler sentence. */
  detail: string;
}

/** The bits of a test result the prompt needs. `TestResult` satisfies this. */
export interface ReportedCheck {
  status: string;
  name: string;
  command?: string;
  stdin?: string;
  expected?: string;
  actual?: string;
  message?: string;
}

export interface TutorPromptInput {
  title: string;
  statement: string;
  /** The code that produced `failing`. The panel refuses to ask when the editor has moved on. */
  code: string;
  diagnostics: string;
  failing: readonly TutorFailureCase[];
  /** Names of checks that did not run, so the tutor does not invent their output. */
  skipped: readonly string[];
  /** Hint texts the learner has already opened, in order. Never the later tiers. */
  openedHints: readonly string[];
  solution: string;
  question: TutorQuestion;
  /** The learner's sentence for "why doesn't my approach work?". */
  approach?: string;
}

/** The request carries one user message: the instructions come first, then the exercise data. */
export interface TutorMessage { role: 'user'; content: string }

const CAP = {
  statement: 8_000,
  code: 60_000,
  diagnostics: 8_000,
  solution: 60_000,
  hint: 4_000,
  io: 4_000,
  approach: 2_000,
  cases: 30,
} as const;

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated]`;
}

export function openedHintTexts(hints: readonly string[], viewed: number): string[] {
  if (!Number.isFinite(viewed) || viewed <= 0) return [];
  const n = Math.min(hints.length, Math.floor(viewed));
  return hints.slice(0, n).map(h => cap(h, CAP.hint));
}

export function failingChecks(results: readonly ReportedCheck[]): TutorFailureCase[] {
  const out: TutorFailureCase[] = [];
  for (const r of results) {
    if (r.status !== 'fail' || out.length >= CAP.cases) continue;
    const input = [
      r.command ? `command: ${r.command}` : '',
      r.stdin !== undefined ? `stdin: ${JSON.stringify(r.stdin)}` : '',
    ].filter(Boolean).join('\n');
    out.push({
      name: r.name,
      input: cap(input, CAP.io) || '(no program input)',
      expected: r.expected !== undefined ? cap(r.expected, CAP.io) : '',
      actual: r.actual !== undefined ? cap(r.actual, CAP.io) : '',
      detail: cap(r.message ?? '', CAP.io),
    });
  }
  return out;
}

export function skippedChecks(results: readonly ReportedCheck[]): string[] {
  return results.filter(r => r.status === 'skip').map(r => r.name).slice(0, CAP.cases);
}

const INSTRUCTIONS = [
  'You are the tutor for The Definitive C Course. The learner\'s program failed a check.',
  'Help them take one next step. Do not write the corrected program, and do not reveal the reference solution.',
  'The reference solution is included only so you can avoid repeating it. It is marked NEVER REVEAL.',
  'When you say what the program printed or returned, quote only the results supplied in the user message.',
  'If a result you would need was not supplied, say "I\'m not sure" and do not predict the output.',
  'For "Give me a nudge": one next step, as a question or a pointer to a concept or a line. No corrected code.',
  'For "Why doesn\'t my approach work?": explain where the learner\'s idea breaks, using the supplied results. No corrected code.',
  'Do not include a code block longer than three lines.',
  'Mention only the hints listed as already opened. Do not invent a later hint.',
].join('\n');

function caseBlock(c: TutorFailureCase): string {
  return [
    `- ${c.name}`,
    `  input: ${c.input}`,
    `  expected output: ${JSON.stringify(c.expected)}`,
    `  actual output: ${JSON.stringify(c.actual)}`,
    c.detail ? `  detail: ${c.detail}` : '',
  ].filter(Boolean).join('\n');
}

/** One user message: the instructions, then the exercise. The solution is in it, marked never reveal. */
export function buildTutorMessages(input: TutorPromptInput): TutorMessage[] {
  const hints = input.openedHints.length
    ? input.openedHints.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '(none opened)';
  const failing = input.failing.length ? input.failing.map(caseBlock).join('\n') : '(none)';
  const skipped = input.skipped.length ? input.skipped.join(', ') : '(none)';
  const question = input.question === 'nudge'
    ? 'Question: Give me a nudge.'
    : `Question: Why doesn't my approach work?\nThe learner's idea: ${cap(input.approach?.trim() || '(no sentence)', CAP.approach)}`;
  const exercise = [
    `Exercise: ${cap(input.title, 300)}`,
    '',
    'Statement:',
    cap(input.statement, CAP.statement),
    '',
    'Learner\'s code (this is the code that was checked):',
    cap(input.code, CAP.code),
    '',
    'Compiler diagnostics:',
    cap(input.diagnostics.trim() || '(none)', CAP.diagnostics),
    '',
    'Failing checks (these outputs are from running the code above; quote them, do not invent others):',
    failing,
    '',
    'Checks that did not run (there is no output for these):',
    skipped,
    '',
    'Hints the learner has already opened:',
    hints,
    '',
    'Reference solution (NEVER REVEAL):',
    cap(input.solution, CAP.solution),
    '',
    question,
  ].join('\n');
  return [{ role: 'user', content: `${INSTRUCTIONS}\n\n${exercise}` }];
}
