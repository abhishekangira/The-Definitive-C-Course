// Quiz rules: content/modules/<module>/quizzes/{checkpoint,retrieval}.yaml (PLAN §2.4 "Quizzes", §2.5).
//
// A quiz file is a YAML list of typed items. The schema (documented in README.md):
//
//   id        kebab-case, unique in the module (items with `code` are also samples, so unique course-wide)
//   type      predict | outcome | choice | ce | md | sp | exercise | np | order
//   prompt    the question (Markdown)
//   explain   shown after answering (required for every type that shows feedback)
//   code?     a C program; it is a verified sample: its output/diagnostics/trace come from running it
//   meta?     fence meta for that sample, e.g. `expect=compile-error` or `stdin="3\n"` (never `id=`)
//   choices?  options for choice and ce
//   answer?   index into choices, only for items whose answer cannot come from running code:
//             a choice item without code, or a ce item (which explanation of the message is right)
//   exercise? exercise id, for type exercise
//   sample/line/items?  md/sp: the traced sample, the line the diagram pauses before, the cells to fill in;
//             np: [value, from, to, width]; order: the lines in their correct order
//   session?  a native session of this module (docs/adr/0005-native-sessions.md). ce: its stored report is the message
//             shown instead of `code` (`step`: which step, 1-based, default the last; `stage`: also asks which build stage
//             failed). order: the session runs exactly `items` as its steps, on every platform, and is the answer key
//   transfer? true on the checkpoint item set in an unfamiliar context
//   from?     retrieval only: the module the item comes from (m01…), or "js" for Module 1's diagnostic
import path from 'node:path';
import type { SampleMeta } from '../../src/content-model/types';
import { parseFenceMeta } from '../verify/meta';
import type { ModuleCtx, SiteCtx } from './context';
import { moduleNumber } from './context';
import { discoverSessions, stepsFor } from '../verify/session';
import { sessionOrder } from '../../src/interactions/quiz-answers';
import { checkExerciseRef, checkSampleRef, notLinkerReports, STAGES, storedSessions } from './lesson';
import type { Collector, FileReporter } from './messages';
import { checkSampleMeta, type SampleInfo } from './samples';
import { YamlFile } from './yaml-file';

export const QUIZ_TYPES = ['predict', 'outcome', 'choice', 'ce', 'md', 'sp', 'exercise', 'np', 'order'] as const;
export type QuizType = (typeof QUIZ_TYPES)[number];

/** How each item type with code is predicted (mirrors tools/verify/discover.ts). */
export const QUIZ_PREDICT: Partial<Record<QuizType, SampleMeta['predict']>> = {
  predict: 'output', outcome: 'outcome', choice: 'choice', ce: 'none', md: 'none', sp: 'none',
};

const ITEM_KEYS = new Set(['id', 'type', 'prompt', 'code', 'meta', 'choices', 'answer', 'exercise', 'transfer', 'explain', 'from', 'sample', 'items', 'line', 'session', 'step', 'stage']);
const PLATFORMS = ['linux-gcc', 'linux-clang', 'macos'] as const;
const BASES = new Set(['dec', 'bin', 'hex']);
const NP_WIDTHS = new Set(['8', '16', '32', '64']);

export const CHECKPOINT_MIN = 8;
export const CHECKPOINT_MAX = 12;
export const RETRIEVAL_MIN = 6;
export const RETRIEVAL_MAX = 10;

export type QuizKind = 'checkpoint' | 'retrieval';

export interface QuizDoc {
  kind: QuizKind;
  file: string;
  yaml: YamlFile;
  /** Raw items (anything: they are validated one by one). */
  items: unknown[];
  /** False when the YAML did not parse or is not a list. */
  ok: boolean;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** A quiz file holds a list, or an object with `items`, `pool` or `questions` (as tools/verify accepts). */
function itemsOf(doc: unknown): { items: unknown[]; key?: string } | null {
  if (Array.isArray(doc)) return { items: doc };
  if (isObj(doc)) {
    for (const k of ['items', 'pool', 'questions']) if (Array.isArray(doc[k])) return { items: doc[k] as unknown[], key: k };
  }
  return null;
}

/** Reads a quiz file and registers the samples its code items define. */
export function loadQuiz(file: string, kind: QuizKind, mod: ModuleCtx, rep: Collector): QuizDoc {
  const r = rep.at(file, mod.id);
  const yaml = YamlFile.read(file);
  const doc: QuizDoc = { kind, file, yaml, items: [], ok: false };
  if (!yaml.reportSyntax(r)) return doc;
  const holder = itemsOf(yaml.value);
  if (!holder) {
    r.error(1, 'quiz-schema', 'a quiz file must be a YAML list of items (or an object with an `items` list)');
    return doc;
  }
  doc.items = holder.items;
  doc.ok = true;

  holder.items.forEach((raw, i) => {
    if (!isObj(raw) || typeof raw.code !== 'string' || !text(raw.id) || !QUIZ_TYPES.includes(raw.type as QuizType)) return;
    const type = raw.type as QuizType;
    if (!(type in QUIZ_PREDICT)) return; // exercise, np, order carry no sample
    const at = yaml.lineOf(holder.key ? [holder.key, i] : [i]);
    let parsed;
    try {
      parsed = parseFenceMeta(`id=${raw.id} ${typeof raw.meta === 'string' ? raw.meta : ''}`.trim());
    } catch (e) {
      r.error(at, 'quiz-meta', `item "${String(raw.id)}": ${(e as Error).message}`);
      return;
    }
    if (!parsed.meta || parsed.meta.fragment) return; // reported by the item rules
    const meta: SampleMeta = { ...parsed.meta, predict: QUIZ_PREDICT[type] };
    const info: SampleInfo = { id: meta.id, file, line: at, module: mod.id, where: 'quiz', meta, code: raw.code, warns: Object.keys(parsed.ext.warnByTarget).length > 0 };
    mod.samples.set(meta.id, [...(mod.samples.get(meta.id) ?? []), info]);
  });
  return doc;
}

// ---------------------------------------------------------------------------------------------

function choiceTexts(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const c of v) {
    const t = typeof c === 'string' ? c : isObj(c) ? (c.text ?? c.label) : undefined;
    if (!text(t)) return null;
    out.push(t);
  }
  return out;
}

function parseNumberText(s: string): boolean {
  return /^-?\d+$/.test(s.trim()) || /^0b[01]+$/i.test(s.trim()) || /^0x[0-9a-f]+$/i.test(s.trim());
}

interface ItemCtx {
  doc: QuizDoc;
  index: number;
  item: Raw;
  mod: ModuleCtx;
  site: SiteCtx;
  r: FileReporter;
  /** Line of a field of this item (the item's own line when the field is absent). */
  at: (field?: string) => number;
}

/** Item-level rules. Returns the referenced exercise kind for exercise items. */
function checkItem(c: ItemCtx): { exerciseKind?: string } {
  const { item, r, at, mod, site } = c;
  const type = item.type as QuizType;
  const id = String(item.id);
  const err = (field: string | undefined, rule: string, message: string) => r.error(at(field), rule, `item "${id}": ${message}`);
  const warn = (field: string | undefined, rule: string, message: string) => r.warn(at(field), rule, `item "${id}": ${message}`);

  for (const k of Object.keys(item)) if (!ITEM_KEYS.has(k)) warn(k, 'quiz-schema', `unknown field "${k}" (known: ${[...ITEM_KEYS].join(', ')})`);
  if (!text(item.prompt)) err('prompt', 'quiz-schema', '`prompt` is required');
  const needsExplain = type !== 'exercise' && type !== 'np';
  if (needsExplain && !text(item.explain)) err('explain', 'quiz-schema', `\`explain\` is required for ${type} items: feedback says why the answer is right`);
  if (item.transfer !== undefined && typeof item.transfer !== 'boolean') err('transfer', 'quiz-schema', '`transfer` must be true or false');
  if (item.code !== undefined && !text(item.code)) err('code', 'quiz-schema', '`code` must be a non-empty string');
  if (item.meta !== undefined && typeof item.meta !== 'string') err('meta', 'quiz-schema', '`meta` must be a string of fence options, e.g. expect=compile-error');
  if (typeof item.meta === 'string' && /(^|\s)id=/.test(item.meta)) err('meta', 'quiz-meta', '`meta` must not set id=: the item id is the sample id');

  const hasCode = typeof item.code === 'string';
  const choices = choiceTexts(item.choices);
  const answer = item.answer;
  const checkChoices = (min: number, max: number) => {
    if (!choices || choices.length < min || choices.length > max) {
      err('choices', 'quiz-schema', `\`choices\` must be a list of ${min}-${max} non-empty strings`);
      return;
    }
    if (new Set(choices.map(x => x.trim())).size !== choices.length) err('choices', 'quiz-schema', '`choices` has duplicate entries');
  };
  const checkAnswerIndex = () => {
    if (!Number.isInteger(answer) || (answer as number) < 0 || (choices && (answer as number) >= choices.length)) {
      err('answer', 'quiz-schema', `\`answer\` must be an index into \`choices\`${choices ? ` (0-${choices.length - 1})` : ''}`);
    }
  };
  const forbid = (field: string, why: string) => {
    if (item[field] !== undefined) err(field, 'quiz-schema', `${type} items take no \`${field}\`: ${why}`);
  };

  // session: a native session folder of this module; its stored run (src/generated/sessions) when verify has made it.
  const session = item.session;
  let spec: ReturnType<typeof discoverSessions>['sessions'][number] | undefined;
  if (session !== undefined) {
    if (type !== 'ce' && type !== 'order') err('session', 'quiz-schema', '`session` is for ce items (the report shown) and order items (the commands to order)');
    else if (!text(session)) err('session', 'quiz-schema', '`session` must be a session id');
    else if (!(spec = discoverSessions(site.contentRoot, mod.id).sessions.find(x => x.id === session))) err('session', 'quiz-schema', `no session "${session}" in this module (modules/${mod.name}/sessions/${session}/session.yaml)`);
  }
  const stored = text(session) && spec ? storedSessions(site, mod.id)?.sessions[session] : undefined;
  if ((item.step !== undefined || item.stage !== undefined) && (type !== 'ce' || session === undefined)) err(item.step !== undefined ? 'step' : 'stage', 'quiz-schema', '`step` and `stage` are for ce items with `session`');

  let exerciseKind: string | undefined;
  switch (type) {
    case 'predict':
    case 'outcome':
      if (!hasCode) err('code', 'quiz-schema', `${type} items need \`code\`: the answer is generated by running it`);
      forbid('choices', 'the learner types or picks the outcome and the answer comes from running the code');
      forbid('answer', 'the answer comes from running the code, never from a typed value');
      break;
    case 'choice':
      checkChoices(2, 6);
      if (hasCode) {
        forbid('answer', 'with `code`, the right choice is the one equal to the program\'s output (generated); remove `answer`');
      } else if (answer === undefined) err(undefined, 'quiz-schema', 'a choice item without `code` needs `answer` (the index of the right choice)');
      else checkAnswerIndex();
      break;
    case 'ce':
      checkChoices(2, 6);
      if (answer === undefined) err(undefined, 'quiz-schema', 'a ce item needs `answer` (the index of the right explanation of the message)');
      else checkAnswerIndex();
      if (session !== undefined) {
        forbid('code', 'the session\'s stored report is the message shown');
        forbid('meta', 'the session says how it runs');
        const step = item.step;
        if (step !== undefined && (!Number.isInteger(step) || (step as number) < 1)) err('step', 'quiz-schema', '`step` must be a step number (1 or more)');
        else if (spec && step !== undefined && PLATFORMS.every(p => stepsFor(spec!, p).length < (step as number))) err('step', 'quiz-schema', `session "${String(session)}" has no step ${String(step)}`);
        if (item.stage !== undefined && !STAGES.includes(item.stage as string)) err('stage', 'quiz-schema', `\`stage\` must be one of ${STAGES.join(', ')}`);
        else if (item.stage === 'link' && stored && (step === undefined || Number.isInteger(step))) {
          const notLinker = notLinkerReports(stored, (step as number | undefined) ?? 'last');
          if (notLinker.length) err('stage', 'quiz-schema', `stage is "link", but the stored ${notLinker.join(' and ')} report${step !== undefined ? ` at step ${String(step)}` : ''} is not a linker's (no "undefined reference", "multiple definition" or "ld returned"): pick the step that links, or the stage that failed`);
        }
        break;
      }
      if (!hasCode) err('code', 'quiz-schema', 'ce items need `code` (the compiler message shown is generated by compiling it) or `session` (a stored native report)');
      if (typeof item.meta !== 'string' || !/(^|\s)(expect(\.\w+)?=(compile-error|warning|runtime-error|ub)|warn(\.\w+)?=\S|target=native)(\s|$)/.test(item.meta)) {
        warn('meta', 'quiz-schema', 'a ce item should say what the tool reports: add expect=compile-error (or expect=warning, or warn=-Wxxx) to `meta`');
      }
      break;
    case 'md':
    case 'sp': {
      const sample = item.sample;
      if (!text(sample)) err('sample', 'quiz-schema', `${type} items need \`sample\`: the id of the traced program`);
      else {
        const hit = checkSampleRef(sample, mod, site, r, at('sample'), true, `item "${id}"`);
        if (hasCode && sample !== id) warn('sample', 'quiz-schema', `\`sample\` is "${sample}" but the item defines its own code as "${id}": the item's code is never traced`);
        if (hit && Number.isInteger(item.line) && (item.line as number) > hit.code.replace(/\n$/, '').split('\n').length) {
          err('line', 'quiz-schema', `\`line\` ${String(item.line)} is past the end of sample "${sample}" (${hit.code.replace(/\n$/, '').split('\n').length} lines)`);
        }
      }
      if (!Number.isInteger(item.line) || (item.line as number) < 1) err('line', 'quiz-schema', `${type} items need \`line\`: the source line the ${type === 'md' ? 'diagram pauses' : 'debugger is paused'} before`);
      if (type === 'md') {
        const cells = item.items;
        if (!Array.isArray(cells) || cells.length === 0 || !cells.every(text)) err('items', 'quiz-schema', 'md items need `items`: the cells to fill in, e.g. ["add.a", "main.x"]');
      }
      forbid('choices', 'the answers come from the gdb trace');
      forbid('answer', 'the answers come from the gdb trace');
      break;
    }
    case 'exercise': {
      if (!text(item.exercise)) {
        err('exercise', 'quiz-schema', 'exercise items need `exercise`: the id of a folder under exercises/');
      } else {
        const ex = checkExerciseRef(item.exercise, mod, site, r, at('exercise'));
        exerciseKind = ex?.kind;
      }
      forbid('code', 'the exercise folder holds the program');
      forbid('choices', 'it is graded by the exercise tests');
      forbid('answer', 'it is graded by the exercise tests');
      break;
    }
    case 'np': {
      const v = item.items;
      if (!Array.isArray(v) || v.length !== 4 || !v.every(x => typeof x === 'string' || typeof x === 'number')) {
        err('items', 'quiz-schema', 'np items need `items: [value, from, to, width]`, e.g. ["13", "dec", "bin", "8"]');
        break;
      }
      const [value, from, to, width] = v.map(String);
      if (!parseNumberText(value)) err('items', 'quiz-schema', `np value "${value}" must be a decimal, 0b… or 0x… number`);
      if (!BASES.has(from) || !BASES.has(to)) err('items', 'quiz-schema', 'np `from` and `to` must each be dec, bin or hex');
      else if (from === to) err('items', 'quiz-schema', 'np `from` and `to` are the same base: there is nothing to convert');
      if (!NP_WIDTHS.has(width)) err('items', 'quiz-schema', 'np width must be 8, 16, 32 or 64');
      forbid('code', 'the answer is computed from the number');
      break;
    }
    case 'order': {
      const v = item.items;
      if (!Array.isArray(v) || v.length < 2 || !v.every(text)) err('items', 'quiz-schema', 'order items need `items`: at least two lines, listed in their correct order');
      else if (new Set(v.map(x => String(x).trim())).size !== v.length) err('items', 'quiz-schema', 'order `items` has duplicates: the correct order would be ambiguous');
      forbid('code', 'order items sort plain text; put programs in an exercise of kind pa');
      forbid('choices', 'the learner orders `items`');
      // With a session, the stored run is the answer key: it must run exactly these commands in this order everywhere.
      if (spec && Array.isArray(v)) {
        const want = v.map(String).join('\n');
        const off = PLATFORMS.filter(p => stepsFor(spec!, p).length && stepsFor(spec!, p).map(x => x.run.trim()).join('\n') !== want);
        if (off.length) err('items', 'quiz-order', `session "${String(session)}" does not run \`items\` in this order on ${off.join(' and ')}: its steps must be exactly the items, in order, on every platform (the stored run is the answer key)`);
        const key = stored && sessionOrder(stored);
        if (key && !off.length && ('problem' in key || key.order.join('\n') !== want)) err('items', 'quiz-order', `the stored run of session "${String(session)}" ${'problem' in key ? `is no answer key: ${key.problem}` : 'runs other commands than `items`'}: run npm run verify`);
      }
      break;
    }
  }
  return { exerciseKind };
}

/** Rules for one quiz file: item schema, then the file-level composition rules. */
export function checkQuiz(doc: QuizDoc, mod: ModuleCtx, site: SiteCtx, rep: Collector, seenIds: Map<string, { file: string; line: number }>): void {
  const r = rep.at(doc.file, mod.id);
  if (!doc.ok) return;
  const holder = itemsOf(doc.yaml.value);
  const kinds: Array<{ type?: string; exerciseKind?: string; transfer: boolean; from?: string }> = [];

  doc.items.forEach((raw, index) => {
    const base = holder?.key ? [holder.key, index] : [index];
    const lineAt = (field?: string) => doc.yaml.lineOf(field ? [...base, field] : base);
    if (!isObj(raw)) {
      r.error(lineAt(), 'quiz-schema', `item ${index + 1} must be a mapping with id, type and prompt`);
      return;
    }
    const idText = text(raw.id) ? raw.id : undefined;
    if (!idText) { r.error(lineAt(), 'quiz-schema', `item ${index + 1} needs an \`id\``); return; }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(idText)) r.error(lineAt('id'), 'quiz-schema', `item id "${idText}" must be lower-case kebab-case`);
    const prev = seenIds.get(idText);
    if (prev) r.error(lineAt('id'), 'quiz-id', `item id "${idText}" is already used at ${path.relative(site.siteRoot, prev.file)}:${prev.line}: item ids are unique within a module`);
    else seenIds.set(idText, { file: doc.file, line: lineAt('id') });
    if (!QUIZ_TYPES.includes(raw.type as QuizType)) {
      r.error(lineAt('type'), 'quiz-schema', `item "${idText}": \`type\` must be one of ${QUIZ_TYPES.join(', ')}`);
      return;
    }
    const type = raw.type as QuizType;

    const { exerciseKind } = checkItem({ doc, index, item: raw, mod, site, r, at: lineAt });

    // The sample this item defines (when it has code) gets the shared meta rules.
    if (typeof raw.code === 'string' && type in QUIZ_PREDICT) {
      const sample = mod.samples.get(idText)?.find(s => s.file === doc.file);
      if (sample) {
        checkSampleMeta(sample.meta, sample.code, sample.line, r, { moduleId: mod.id, standalone: false });
        if (sample.meta.fragment) r.error(lineAt('meta'), 'quiz-meta', `item "${idText}": quiz code must be a runnable sample, not a fragment`);
      }
    }
    if (doc.kind === 'checkpoint' && raw.from !== undefined) r.warn(lineAt('from'), 'quiz-schema', `item "${idText}": \`from\` is for retrieval quizzes`);
    if (doc.kind === 'retrieval' && raw.transfer !== undefined) r.warn(lineAt('transfer'), 'quiz-schema', `item "${idText}": \`transfer\` is for checkpoints`);
    kinds.push({ type, exerciseKind, transfer: raw.transfer === true, from: typeof raw.from === 'string' ? raw.from : undefined });
  });

  if (doc.kind === 'checkpoint') checkCheckpointComposition(doc, kinds, r);
  else checkRetrieval(doc, kinds, mod, site, r, holder?.key);
}

/** PLAN §2.5: 8–12 items including write-code, fix-a-bug, memory/stepper, compiler message and a transfer item. */
function checkCheckpointComposition(doc: QuizDoc, items: Array<{ type?: string; exerciseKind?: string; transfer: boolean }>, r: FileReporter): void {
  const n = doc.items.length;
  if (n < CHECKPOINT_MIN || n > CHECKPOINT_MAX) {
    r.error(1, 'checkpoint-composition', `checkpoint has ${n} items; it needs ${CHECKPOINT_MIN}-${CHECKPOINT_MAX} (PLAN §2.5)`);
  }
  const exercises = items.map((it, i) => ({ ...it, i })).filter(it => it.type === 'exercise');
  const write = exercises.filter(e => e.exerciseKind === 'ct' || e.exerciseKind === 'lt');
  const fix = exercises.filter(e => e.exerciseKind === 'fb' || e.exerciseKind === 'lt');
  const distinct = new Set([...write, ...fix].map(e => e.i));
  const missing: string[] = [];
  if (write.length === 0) missing.push('a write-code item (type exercise whose exercise has kind ct, or lt for a native-only skill)');
  if (fix.length === 0) missing.push('a fix-a-bug item (type exercise whose exercise has kind fb, or lt)');
  if (write.length > 0 && fix.length > 0 && distinct.size < 2) {
    missing.push('a second exercise item: the only ct/fb/lt exercise would have to be both the write-code and the fix-a-bug item');
  }
  if (!items.some(it => it.type === 'md' || it.type === 'sp')) missing.push('a memory-diagram or stepper item (type md or sp)');
  if (!items.some(it => it.type === 'ce')) missing.push('a compiler/tool-message item (type ce)');
  if (!items.some(it => it.transfer)) missing.push('a transfer item set in an unfamiliar context (`transfer: true`)');
  for (const m of missing) r.error(1, 'checkpoint-composition', `checkpoint is missing ${m}`);
}

/** PLAN §2.5: 6–10 items, taken from earlier modules (M1: a JS diagnostic). */
function checkRetrieval(doc: QuizDoc, items: Array<{ from?: string }>, mod: ModuleCtx, site: SiteCtx, r: FileReporter, key: string | undefined): void {
  const n = doc.items.length;
  if (n < RETRIEVAL_MIN || n > RETRIEVAL_MAX) r.error(1, 'retrieval-composition', `retrieval quiz has ${n} items; it needs ${RETRIEVAL_MIN}-${RETRIEVAL_MAX} (PLAN §2.5)`);
  const me = moduleNumber(mod.id);
  const known = new Map(site.course?.modules.map(m => [m.id, m]) ?? []);
  const counts = new Map<string, number>();
  items.forEach((it, i) => {
    const at = doc.yaml.lineOf(key ? [key, i, 'from'] : [i, 'from']);
    if (!it.from) { r.error(at, 'retrieval-from', `item ${i + 1} needs \`from\`: the module it comes from (e.g. from: m01)${me === 1 ? ' or from: js for the JS diagnostic' : ''}`); return; }
    counts.set(it.from, (counts.get(it.from) ?? 0) + 1);
    if (me === 1) {
      if (it.from !== 'js') r.error(at, 'retrieval-from', `Module 1 has no earlier module: its retrieval quiz is the JS diagnostic (from: js), not from: ${it.from}`);
      return;
    }
    if (it.from === 'js') { r.error(at, 'retrieval-from', 'from: js is only for Module 1\'s diagnostic; later modules draw on earlier modules'); return; }
    if (!/^m\d{2}$/.test(it.from) || (typeof me === 'number' && Number(it.from.slice(1)) >= me)) {
      r.error(at, 'retrieval-from', `from: ${it.from} is not an earlier module (this is ${mod.id})`);
    } else if (site.course && !known.has(it.from)) {
      r.error(at, 'retrieval-from', `from: ${it.from} is not a module in content/course.yaml`);
    }
  });
  if (typeof me === 'number' && me >= 2) {
    const previous = `m${String(me - 1).padStart(2, '0')}`;
    if (me >= 2 && n > 0 && !counts.has(previous)) {
      r.warn(1, 'retrieval-composition', `no item comes from the previous module (${previous}): PLAN §2.5 draws roughly 40% from it, 30% from two back and 30% older`);
    }
    if (me >= 3 && n > 0 && counts.size === 1) {
      r.warn(1, 'retrieval-composition', 'every item comes from one module: PLAN §2.5 spreads items over the previous module, two back and older ones');
    }
  }
}
