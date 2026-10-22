// Lesson MDX rules (PLAN §2.4 content format and §2.5 cadence lint).
//
// A lesson is parsed with the same unified pipeline as the site (remark-parse, remark-mdx, remark-frontmatter,
// remark-gfm), its ```c fences are turned into <CodeSample>/<CodeBlock> exactly as tools/mdx/remark-course.ts does
// (but reporting instead of throwing), and the top-level nodes are grouped into cards with groupCards(): so the
// word budget is measured on the cards learners see.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import type { Code, Root, RootContent } from 'mdast';
import { countWords, groupCards, INTERACTIONS, MEDIA, NEUTRAL } from '../../src/content-model/cards';
import type { SampleMeta, SessionResult, SessionsFile } from '../../src/content-model/types';
import { transcriptTabs } from '../../src/components/transcript-tabs';
import { isLinkerReport } from '../../src/interactions/report-questions';
import { floatDrillBits, floatFromBits, hasExactDecimal } from '../../src/visualizers/numbers';
import { lowerCodeFence } from '../mdx/remark-course';
import { parseFenceMeta } from '../verify/meta';
import type { ModuleCtx, SiteCtx } from './context';
import { attr, hasSpread, isJsx, jsxElements, line, nestedLowered, UNKNOWN, type JsxNode, type Literal } from './jsx';
import type { Collector, FileReporter } from './messages';
import { checkSampleMeta, type SampleInfo } from './samples';
import { YamlFile } from './yaml-file';

/** PLAN §2.5: at most ~250 words of prose between interactions. */
export const MAX_CARD_WORDS = 250;
export const MIN_LESSON_MINUTES = 25;
export const MAX_LESSON_MINUTES = 60;
export const MIN_CARDS = 2;
export const MAX_CARDS = 14;
export const MAX_VIDEOS_PER_MODULE = 2;

/** Components registered for MDX (src/content-runtime/mdx-components.tsx) plus the planned ones in cards.ts. */
export const KNOWN_ELEMENTS = new Set<string>([...INTERACTIONS, ...MEDIA, ...NEUTRAL, 'Card', 'TestExample', 'Kbd']);

/** Fences that hold terminal text, and the markers of tool output in them (`hand-typed-output`; issue #73, infrastructure E). */
const OUTPUT_FENCE_LANGS = new Set(['', 'text', 'txt', 'console', 'sh', 'bash', 'shell']);
// Compiler diagnostics (`main.c:5:3: error:`), linker errors, a shell's crash report and Valgrind's leak summary too.
const TOOL_OUTPUT_MARKERS = /runtime error:|==\d+==|==PID==|undefined reference|multiple definition|ld returned|AddressSanitizer|\(gdb\)|\(lldb\)|make: \*\*\*|\w+\.[ch]:\d+:\d+: (error|warning):|Segmentation fault|definitely lost/;

const FRONTMATTER_KEYS = new Set(['id', 'title', 'minutes', 'summary']);
const BASES = new Set(['dec', 'bin', 'hex']);
const WIDTHS = new Set([8, 16, 32, 64]);

const parser = unified().use(remarkParse).use(remarkMdx).use(remarkFrontmatter, ['yaml']).use(remarkGfm);

export interface LoadedLesson {
  file: string;
  stem: string;
  /** null when the MDX did not parse. */
  tree: Root | null;
  /** Parsed frontmatter, null when absent or invalid. */
  frontmatter: Record<string, unknown> | null;
  /** Line of the frontmatter's opening `---` (0 when there is none). */
  fmLine: number;
  fm: YamlFile | null;
}

/** Position of a micromark/mdx syntax error. */
function parseErrorLine(e: unknown): number {
  const err = e as { line?: number | null; place?: { line?: number; start?: { line?: number } } };
  return err.line ?? err.place?.line ?? err.place?.start?.line ?? 1;
}

/** Reads and parses a lesson, lowers its C fences, and registers its samples in the module. */
export function loadLesson(file: string, mod: ModuleCtx, rep: Collector): LoadedLesson {
  const r = rep.at(file, mod.id);
  const stem = path.basename(file).replace(/\.mdx$/, '');
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const loaded: LoadedLesson = { file, stem, tree: null, frontmatter: null, fmLine: 0, fm: null };
  let tree: Root;
  try {
    tree = parser.parse(text) as Root;
  } catch (e) {
    r.error(parseErrorLine(e), 'mdx-parse', `MDX does not parse: ${(e as Error).message.split('\n')[0]}`);
    return loaded;
  }
  loaded.tree = tree;

  const yamlNode = tree.children.find(n => (n as { type: string }).type === 'yaml') as unknown as { value: string; position?: { start: { line: number } } } | undefined;
  if (yamlNode) {
    loaded.fmLine = line(yamlNode);
    const y = new YamlFile(file, yamlNode.value);
    loaded.fm = y;
    // Syntax errors are reported with file lines (the YAML text starts on the line after the opening ---).
    for (const e of y.doc.errors) r.error(loaded.fmLine + (e.linePos?.[0].line ?? 1), 'frontmatter', `frontmatter YAML error: ${e.message.split('\n')[0]}`);
    const value = y.doc.errors.length === 0 ? y.value : null;
    if (value && typeof value === 'object' && !Array.isArray(value)) loaded.frontmatter = value as Record<string, unknown>;
  }

  lowerFences(tree, file, mod, r);
  return loaded;
}

/** Gives a lowered node the source position and marker the lint rules need (see jsx.ts). */
function lowered(n: RootContent, at: Code, data: JsxNode['data']): RootContent {
  return { ...n, position: at.position, data } as unknown as RootContent;
}

/** The fence-to-component step is `lowerCodeFence()` from tools/mdx/remark-course.ts, shared with the site's plugin; here errors are reported instead of thrown. */
function lowerFences(tree: Root, file: string, mod: ModuleCtx, r: FileReporter): void {
  visit(tree, 'code', (node: Code, index, parent) => {
    if (!parent || index === undefined) return;
    const at = line(node);
    const lang = node.lang ?? '';
    const replace = (n: RootContent) => { (parent.children as RootContent[])[index] = n; };
    if (lang === 'C' || lang === 'H') {
      r.error(at, 'fence-lang', `the fence language is case-sensitive: use \`c\` (or \`h\`), not \`${lang}\`, or the fence is not treated as a sample`);
      return;
    }
    if (lang !== 'c' && lang !== 'h') {
      const marker = OUTPUT_FENCE_LANGS.has(lang) ? TOOL_OUTPUT_MARKERS.exec(node.value) : null;
      if (marker) {
        r.error(at, 'hand-typed-output', `this \`\`\`${lang || '(untagged)'} fence contains tool output ("${marker[0]}"): tool output is never typed by hand, show it with <Transcript session="…"> from a native session`);
      }
      if (!lang && /#\s*include\b|\bint\s+main\s*\(/.test(node.value)) {
        r.warn(at, 'fence-lang', 'this fence has no language but looks like C: tag it ```c with id=… or fragment so it is verified');
      }
      return;
    }
    const result = lowerCodeFence(node, parseFenceMeta);
    if (!result.ok) {
      r.error(at, result.error.rule, result.error.message);
      replace(lowered(result.fallback, node, { lowered: true }));
      return;
    }
    const { meta, parsed } = result;
    if (meta.fragment) {
      replace(lowered(result.node, node, { lowered: true }));
      return;
    }
    const standalone = parent.type === 'root';
    if (!standalone && !isJsx(parent)) {
      r.warn(at, 'fence-nesting', `sample "${meta.id}" is inside a ${parent.type}: it is not a card interaction there, so nothing gates on it. Put the fence at the top level`);
    }
    const info: SampleInfo = { id: meta.id, file, line: at, module: mod.id, where: 'lesson', meta, code: node.value, warns: Object.keys(parsed.ext.warnByTarget).length > 0 };
    mod.samples.set(meta.id, [...(mod.samples.get(meta.id) ?? []), info]);
    checkSampleMeta(meta, node.value, at, r, { moduleId: mod.id, standalone, lesson: true });
    replace(lowered(result.node, node, { lowered: true, sample: info }));
  });
}

// ---------------------------------------------------------------------------------------------
// Checks

const str = (v: Literal | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

/** A required string prop: reports when absent or empty. Returns the text, or undefined when unknown. */
function requireText(node: JsxNode, name: string, el: string, r: FileReporter, rule: string): string | undefined {
  const a = attr(node, name);
  if (!a.present) {
    if (!hasSpread(node)) r.error(line(node), rule, `<${el}> is missing the \`${name}\` prop`);
    return undefined;
  }
  if (a.value === UNKNOWN) return undefined;
  if (typeof a.value !== 'string' || !a.value.trim()) {
    r.error(line(node), rule, `<${el}> \`${name}\` must be a non-empty string`);
    return undefined;
  }
  return a.value;
}

function checkAnalogy(node: JsxNode, r: FileReporter): void {
  for (const name of ['js', 'c', 'breaksDown']) requireText(node, name, 'Analogy', r, 'analogy');
  const b = attr(node, 'breaksDown').value;
  if (typeof b === 'string' && b.trim()) {
    if (b.trim().length < 30) r.warn(line(node), 'analogy', '<Analogy> `breaksDown` is very short: say what the analogy gets wrong, concretely');
    const m = /\b(exactly|same)\b/i.exec(b);
    if (m) {
      r.warn(line(node), 'analogy-review', `<Analogy> \`breaksDown\` contains "${m[1]}": check it really names a difference rather than restating the likeness (PLAN §2.5)`);
    }
  }
}

/** The shared question/options/answer shape of <Choice> and <CompilerError>. */
function checkChoiceProps(node: JsxNode, el: string, r: FileReporter): void {
  const at = line(node);
  requireText(node, 'question', el, r, 'interaction-props');
  const options = attr(node, 'options');
  let count: number | undefined;
  if (!options.present) {
    if (!hasSpread(node)) r.error(at, 'interaction-props', `<${el}> is missing the \`options\` prop`);
  } else if (options.value !== UNKNOWN) {
    const list = options.value;
    if (!Array.isArray(list) || list.length < 2 || !list.every(o => typeof o === 'string' && o.trim())) {
      r.error(at, 'interaction-props', `<${el}> \`options\` must be an array of at least two non-empty strings`);
    } else if (new Set(list.map(o => (o as string).trim())).size !== list.length) {
      r.error(at, 'interaction-props', `<${el}> \`options\` has duplicate entries`);
    } else count = list.length;
  }
  const answer = attr(node, 'answer');
  if (!answer.present) {
    if (!hasSpread(node)) r.error(at, 'interaction-props', `<${el}> is missing the \`answer\` prop (the index of the right option)`);
  } else if (answer.value !== UNKNOWN) {
    if (typeof answer.value !== 'number') r.error(at, 'interaction-props', `<${el}> \`answer\` must be a number: write answer={1}, not answer="1"`);
    else if (!Number.isInteger(answer.value) || answer.value < 0 || (count !== undefined && answer.value >= count)) {
      r.error(at, 'interaction-props', `<${el}> \`answer\` must be an index into \`options\`${count !== undefined ? ` (0-${count - 1})` : ''}`);
    }
  }
  const explain = attr(node, 'explain');
  if (!explain.present && !hasSpread(node)) r.warn(at, 'interaction-props', `<${el}> has no \`explain\`: say why the answer is right`);
  else if (explain.present && typeof explain.value === 'string' && !explain.value.trim()) r.warn(at, 'interaction-props', `<${el}> \`explain\` is empty`);
}

function resolveExercise(mod: ModuleCtx, id: string) {
  return mod.exercises.get(id.replace(/^exercises\//, ''));
}

/** Reports an exercise reference that points nowhere. Returns the exercise when it exists. */
export function checkExerciseRef(id: string, mod: ModuleCtx, site: SiteCtx, r: FileReporter, at: number) {
  const ex = resolveExercise(mod, id);
  mod.exerciseRefs.add(id.replace(/^exercises\//, '').replace(/\/variants\/[^/]+$/, ''));
  if (ex) return ex;
  const elsewhere = site.modules.find(m => m !== mod && resolveExercise(m, id));
  const where = id.startsWith('project/') ? `project/${id.slice(8)}/exercise.yaml` : `exercises/${id}/exercise.yaml`;
  r.error(at, 'exercise-ref',
    `exercise "${id}" not found: expected ${path.join('content/modules', mod.name, where)}` +
    (elsewhere ? ` (it exists in ${elsewhere.name}, but a module can only use its own exercises)` : ''));
  return undefined;
}

/** Finds a sample by id in the module; reports when it is missing (or lives in another module). */
export function checkSampleRef(id: string, mod: ModuleCtx, site: SiteCtx, r: FileReporter, at: number, needsTrace: boolean, what: string): SampleInfo | undefined {
  const list = mod.samples.get(id);
  if (!list?.length) {
    const elsewhere = site.modules.find(m => m !== mod && m.samples.has(id));
    r.error(at, 'sample-ref', `${what} refers to sample "${id}", which no lesson or quiz of ${mod.id} defines` +
      (elsewhere ? ` (it is defined in ${elsewhere.id}; references stay within one module)` : ''));
    return undefined;
  }
  const sample = list[0];
  if (needsTrace && !sample.meta.trace) {
    r.error(at, 'sample-trace', `${what} needs a trace, but sample "${id}" (${path.basename(sample.file)}:${sample.line}) has no \`trace\` flag in its fence meta`);
  }
  return sample;
}

function checkSampleSource(node: JsxNode, el: string, mod: ModuleCtx, site: SiteCtx, r: FileReporter): void {
  const nested = nestedLowered(node);
  const ref = attr(node, 'sample');
  const at = line(node);
  if (ref.present && ref.value !== UNKNOWN && (typeof ref.value !== 'string' || !ref.value)) {
    r.error(at, 'sample-ref', `<${el}> \`sample\` must be a sample id (a string)`);
    return;
  }
  if (typeof ref.value === 'string') {
    if (nested.length) r.warn(at, 'sample-ref', `<${el}> has both a \`sample\` prop and a nested fence: the nested fence wins`);
    else checkSampleRef(ref.value, mod, site, r, at, true, `<${el}>`);
  } else if (nested.length) {
    const s = nested[0].data?.sample as SampleInfo | undefined;
    if (s && !s.meta.trace) r.error(at, 'sample-trace', `<${el}> needs a trace: add \`trace\` to the fence meta of "${s.id}"`);
  } else if (!ref.present && !hasSpread(node)) {
    r.error(at, 'sample-ref', `<${el}> needs a program: nest a \`\`\`c fence in it or pass sample="<id>"`);
  }
}

export const STAGES = ['preprocess', 'compile', 'assemble', 'link', 'run'];
const FIX_CHECKS = [false, 'compile', 'ubsan', 'leak'];

const sessionFiles = new Map<string, SessionsFile | null>();
export function storedSessions(site: SiteCtx, module: string): SessionsFile | null {
  const file = path.join(site.sessionsRoot, `${module}.json`);
  if (!sessionFiles.has(file)) sessionFiles.set(file, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as SessionsFile : null);
  return sessionFiles.get(file)!;
}

/** stage="link" must be about a linker's report: the platforms whose stored report at `step` is not a linker's. */
export function notLinkerReports(result: SessionResult, step: number | 'last'): string[] {
  return transcriptTabs(result, step).tabs.filter(t => !isLinkerReport(t.steps)).map(t => t.platform);
}

function checkCompilerError(node: JsxNode, r: FileReporter, mod: ModuleCtx, site: SiteCtx): void {
  const nested = nestedLowered(node).map(n => n.data?.sample as SampleInfo | undefined).filter((s): s is SampleInfo => !!s);
  const at = line(node);
  const stage = attr(node, 'stage');
  if (stage.present && stage.value !== UNKNOWN && !STAGES.includes(stage.value as string)) {
    r.error(at, 'interaction-props', `<CompilerError> \`stage\` must be one of ${STAGES.join(', ')}`);
  }
  if (attr(node, 'session').present) {
    // A stored native report: the browser can check a fix only for plain compile errors, UBSan (its guardrail runtime)
    // and heap leaks (leakcheck), so the author says which, or fix={false} and the next LT carries the fix.
    // The program is the session's own; the one nested fence is the fixed version ("Show a fixed version", its verified
    // output, and the e2e click-through), so a fix the browser checks needs it and fix={false} takes none.
    const fix = attr(node, 'fix');
    if (!fix.present) r.error(at, 'interaction-props', '<CompilerError session> needs `fix`: "compile", "ubsan" or "leak" (how the browser checks the fix), or fix={false} when the browser can\'t check it');
    else if (fix.value !== UNKNOWN && !FIX_CHECKS.includes(fix.value as string | boolean)) r.error(at, 'interaction-props', '<CompilerError session> `fix` must be "compile", "ubsan", "leak" or {false}');
    else if (fix.value === false && nested.length) r.error(at, 'interaction-props', '<CompilerError session fix={false}> asks for no fix: remove the nested fence');
    else if (fix.value !== false && fix.value !== UNKNOWN && nested.length !== 1) r.error(at, 'interaction-props', '<CompilerError session> with a fix needs exactly one nested ```c fence: the fixed version of the session\'s program (predict=none)');
    const bad = nested.find(n => [n.meta.expect, ...Object.values(n.meta.expectBy ?? {})].some(e => e === 'compile-error' || e === 'warning' || e === 'ub') || n.warns);
    if (bad) r.error(bad.line, 'interaction-props', `the nested fence of <CompilerError session> ("${bad.meta.id}") is the fixed version: it must compile cleanly and have defined behaviour`);
    // stage="link" must be about a linker's report. Checked against the stored output (not generated yet: verify says so).
    const id = attr(node, 'session').value;
    const step = attr(node, 'step');
    const result = typeof id === 'string' ? storedSessions(site, mod.id)?.sessions[id] : undefined;
    if (stage.value === 'link' && result && step.value !== UNKNOWN) {
      const notLinker = notLinkerReports(result, step.present ? Number(step.value) : 'last');
      if (notLinker.length) r.error(at, 'interaction-props', `<CompilerError session="${String(id)}"> has stage="link", but the stored ${notLinker.join(' and ')} report${step.present ? ` at step ${String(step.value)}` : ''} is not a linker's (no "undefined reference", "multiple definition" or "ld returned"): pick the step that links, or the stage that failed`);
    }
    return;
  }
  if (nested.length === 0) {
    r.error(line(node), 'interaction-props', '<CompilerError> needs a nested ```c fence: the program whose compiler message the learner reads');
    return;
  }
  if (nested.length > 2) r.warn(line(node), 'interaction-props', '<CompilerError> takes at most two fences: the broken program and an optional fixed version');
  const m: SampleMeta = nested[0].meta;
  const expects = [m.expect, ...Object.values(m.expectBy ?? {})];
  if (!nested[0].warns && !expects.some(e => e === 'compile-error' || e === 'warning')) {
    r.error(nested[0].line, 'interaction-props',
      `the first fence of <CompilerError> ("${m.id}") must have expect=compile-error or expect=warning (or required warnings such as warn=-Wformat), or the compiler has no message to read`);
  }
}

function checkNumberDrill(node: JsxNode, r: FileReporter): void {
  const exercise = attr(node, 'exercise');
  if (exercise.present) return; // resolved by the generic `exercise` rule
  const value = attr(node, 'value');
  if (!value.present && !hasSpread(node)) r.error(line(node), 'interaction-props', '<NumberDrill> needs `value` (or `exercise`)');
  const from = attr(node, 'from').value;
  const to = attr(node, 'to').value;
  const kind = attr(node, 'kind').value;
  if (typeof kind === 'string' && kind !== 'int' && kind !== 'float') r.error(line(node), 'interaction-props', '<NumberDrill> `kind` must be int or float');
  if (kind === 'float') { checkFloatDrill(node, value.value, from, to, attr(node, 'width').value, r); return; }
  for (const [name, v] of [['from', from], ['to', to]] as const) {
    if (typeof v === 'string' && !BASES.has(v)) r.error(line(node), 'interaction-props', `<NumberDrill> \`${name}\` must be dec, bin or hex`);
  }
  if (typeof from === 'string' && from === to) r.error(line(node), 'interaction-props', '<NumberDrill> converts a number to another base: `from` and `to` are the same');
  const width = attr(node, 'width').value;
  if (typeof width === 'number' && !WIDTHS.has(width)) r.error(line(node), 'interaction-props', '<NumberDrill> `width` must be 8, 16, 32 or 64');
}

/** `<NumberDrill kind="float">`: a 32-bit float, decoded (hex to dec) or encoded (dec to hex). */
function checkFloatDrill(node: JsxNode, value: Literal | undefined, from: Literal | undefined, to: Literal | undefined, width: Literal | undefined, r: FileReporter): void {
  const at = line(node);
  if (width !== undefined && width !== 32) r.error(at, 'interaction-props', '<NumberDrill kind="float"> is 32-bit: leave out `width` or use 32');
  const decode = from === 'hex' && to === 'dec';
  const encode = from === 'dec' && to === 'hex';
  if (typeof from === 'string' && typeof to === 'string' && !decode && !encode) {
    r.error(at, 'interaction-props', '<NumberDrill kind="float"> decodes (`from="hex" to="dec"`) or encodes (`from="dec" to="hex"`)');
    return;
  }
  if (decode && typeof value === 'string') {
    if (!/^0x[0-9a-f]{8}$/i.test(value)) r.error(at, 'interaction-props', `<NumberDrill kind="float"> decode \`value\` must be 0x followed by 8 hex digits, not "${value}"`);
    else if (!hasExactDecimal(floatFromBits(floatDrillBits(value), 32))) {
      r.error(at, 'interaction-props', `<NumberDrill kind="float"> ${value} has no exact short decimal form (like 0.1f, it is not a value a learner can type); choose one such as 0x3F800000`);
    }
  } else if (decode && typeof value === 'number') r.error(at, 'interaction-props', '<NumberDrill kind="float"> decode `value` is a string such as "0x3F800000"');
  if (encode && typeof value !== 'number' && value !== undefined && value !== UNKNOWN) r.error(at, 'interaction-props', '<NumberDrill kind="float"> encode `value` is a number such as {0.5}');
  if (encode && typeof value === 'number' && !Number.isFinite(value)) r.error(at, 'interaction-props', '<NumberDrill kind="float"> encode `value` must be a finite number');
  if (encode && typeof value === 'number' && !hasExactDecimal(floatFromBits(floatDrillBits(value), 32))) {
    r.error(at, 'interaction-props', `<NumberDrill kind="float"> ${value} is not exactly a float (the nearest float is not ${value}); choose a value such as 0.5 or -2.5`);
  }
}

function checkAnimation(node: JsxNode, site: SiteCtx, r: FileReporter): void {
  const id = requireText(node, 'id', 'Animation', r, 'animation-asset');
  if (!id) return;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { r.error(line(node), 'animation-asset', `<Animation id="${id}"> must be kebab-case (it names a folder)`); return; }
  const steps = path.join(site.publicRoot, 'animations', id, 'steps.json');
  if (existsSync(steps)) return;
  const source = path.join(site.animationsRoot, id);
  if (existsSync(source)) {
    r.warn(line(node), 'animation-asset', `<Animation id="${id}"> is not rendered yet: public/animations/${id}/steps.json is missing (run npm run anim:render)`);
  } else {
    r.error(line(node), 'animation-asset', `<Animation id="${id}">: no HyperFrames project animations/${id}/ and no rendered public/animations/${id}/steps.json`);
  }
}

function checkYouTube(node: JsxNode, mod: ModuleCtx, site: SiteCtx, file: string, r: FileReporter): void {
  const key = requireText(node, 'video', 'YouTube', r, 'video-ref');
  if (!key) return;
  if (!site.videos) {
    r.error(line(node), 'video-ref', `<YouTube video="${key}">: ${path.relative(site.siteRoot, site.videosFile) || 'videos.json'} is missing or unreadable`);
  } else {
    const v = site.videos.get(key);
    if (!v) r.error(line(node), 'video-ref', `<YouTube video="${key}"> is not in videos.json (known keys: ${[...site.videos.keys()].join(', ') || 'none'})`);
    else if (v.module !== mod.id) r.warn(line(node), 'video-ref', `video "${key}" is registered for module ${v.module} (lesson ${v.lesson}) but used in ${mod.id}`);
  }
  if (!mod.videosUsed.has(key)) mod.videosUsed.set(key, { file, line: line(node) });
}

function checkLessonFrontmatter(lesson: LoadedLesson, mod: ModuleCtx, site: SiteCtx, r: FileReporter): void {
  const fm = lesson.frontmatter;
  if (!fm) {
    if (lesson.fmLine === 0) r.error(1, 'frontmatter', 'lesson has no frontmatter: it needs `id`, `title`, `minutes` and `summary` between --- lines');
    else if (lesson.fm?.doc.errors.length === 0) r.error(lesson.fmLine, 'frontmatter', 'frontmatter must be a YAML mapping with `id`, `title`, `minutes` and `summary`');
    return;
  }
  const at = (key: string) => lesson.fmLine + lesson.fm!.lineOf([key]);
  for (const key of ['id', 'title', 'summary']) {
    if (typeof fm[key] !== 'string' || !(fm[key] as string).trim()) r.error(fm[key] === undefined ? lesson.fmLine : at(key), 'frontmatter', `frontmatter \`${key}\` is required and must be a non-empty string`);
  }
  if (typeof fm.minutes !== 'number' || !Number.isFinite(fm.minutes)) {
    r.error(fm.minutes === undefined ? lesson.fmLine : at('minutes'), 'frontmatter', 'frontmatter `minutes` is required and must be a number');
  } else if (fm.minutes < MIN_LESSON_MINUTES || fm.minutes > MAX_LESSON_MINUTES) {
    r.error(at('minutes'), 'lesson-minutes', `lesson is ${fm.minutes} minutes: lessons run ${MIN_LESSON_MINUTES}-${MAX_LESSON_MINUTES} minutes (PLAN §6); split or merge it`);
  }
  for (const key of Object.keys(fm)) {
    if (!FRONTMATTER_KEYS.has(key)) r.warn(at(key), 'frontmatter', `unknown frontmatter key "${key}" (known: ${[...FRONTMATTER_KEYS].join(', ')})`);
  }
  if (typeof fm.id === 'string' && fm.id.trim()) {
    const id = fm.id;
    const prev = site.lessonIds.get(id);
    if (prev) r.error(at('id'), 'lesson-id', `lesson id "${id}" is already used by ${path.relative(site.siteRoot, prev.file)}:${prev.line} (progress is keyed by lesson id)`);
    else site.lessonIds.set(id, { file: lesson.file, line: at('id') });
    if (!new RegExp(`^${mod.id}-l\\d+(?:-[a-z0-9-]+)?$`).test(id)) {
      r.warn(at('id'), 'lesson-id', `lesson id "${id}" should look like "${mod.id}-l<N>" or "${mod.id}-l<N>-<slug>"`);
    }
  }
}

export interface LessonStats {
  cards: number;
  /** Prose words of the longest card. */
  maxWords: number;
  /** Prose words per card, in order. */
  words: number[];
}

/** Runs every rule on one parsed lesson. Needs the module's samples and exercises to be fully loaded. */
export function checkLesson(lesson: LoadedLesson, mod: ModuleCtx, site: SiteCtx, rep: Collector): LessonStats {
  const r = rep.at(lesson.file, mod.id);
  const tree = lesson.tree;
  if (!tree) return { cards: 0, maxWords: 0, words: [] }; // the parse error was reported when loading
  checkLessonFrontmatter(lesson, mod, site, r);

  // --- cadence: the same cards the renderer builds
  const { cards } = groupCards(tree);
  const wordCounts: number[] = [];
  cards.forEach((card, i) => {
    const at = line(card.nodes.find(n => n.position) as { position?: { start: { line: number } } });
    const words = countWords(card.nodes);
    wordCounts.push(words);
    if (words > MAX_CARD_WORDS) {
      r.error(at, 'word-budget', `card ${i + 1} has ${words} words of prose (limit ${MAX_CARD_WORDS}): split the explanation and put an interaction between the halves`);
    }
    const media = jsxElements({ type: 'root', children: card.nodes }).filter(e => e.node.name && MEDIA.has(e.node.name));
    if (media.length > 1) {
      r.error(line(media[1].node), 'media-per-card', `card ${i + 1} has ${media.length} animations/videos: at most one per card, each followed by an interaction`);
    }
    if (media.length >= 1 && !card.interaction) {
      const m = media[0].node;
      r.error(line(m), 'media-needs-interaction', `<${m.name}> is in the last card, which has no interaction: follow every animation or video with a prediction, question or exercise`);
    }
  });
  if (cards.length < MIN_CARDS || cards.length > MAX_CARDS) {
    r.warn(1, 'card-count', `lesson has ${cards.length} card${cards.length === 1 ? '' : 's'}; lessons usually have ${MIN_CARDS}-${MAX_CARDS}`);
  }

  // --- element rules
  for (const { node } of jsxElements(tree)) {
    if (node.data?.lowered) continue;
    const name = node.name;
    if (!name) continue;
    const at = line(node);
    if (!KNOWN_ELEMENTS.has(name)) r.warn(at, 'unknown-component', `<${name}> is not a known lesson component (known: ${[...KNOWN_ELEMENTS].sort().join(', ')})`);
    switch (name) {
      case 'Analogy': checkAnalogy(node, r); break;
      case 'Choice': checkChoiceProps(node, 'Choice', r); break;
      case 'CompilerError': checkChoiceProps(node, 'CompilerError', r); checkCompilerError(node, r, mod, site); break;
      case 'Stepper': checkSampleSource(node, 'Stepper', mod, site, r); break;
      case 'MemoryDiagram': {
        checkSampleSource(node, 'MemoryDiagram', mod, site, r);
        const ask = attr(node, 'ask');
        if (!ask.present && !hasSpread(node)) r.error(at, 'interaction-props', '<MemoryDiagram> needs `ask`, the cells to fill in, e.g. ask={["add.a", "main.x"]}');
        else if (ask.present && ask.value !== UNKNOWN && (!Array.isArray(ask.value) || ask.value.length === 0 || !ask.value.every(a => typeof a === 'string' && a.trim()))) {
          r.error(at, 'interaction-props', '<MemoryDiagram> `ask` must be a non-empty array of cell names');
        }
        break;
      }
      case 'NumberDrill': checkNumberDrill(node, r); break;
      case 'Exercise': {
        const id = requireText(node, 'id', 'Exercise', r, 'exercise-ref');
        if (id) checkExerciseRef(id, mod, site, r, at);
        break;
      }
      case 'Animation': checkAnimation(node, site, r); break;
      case 'YouTube': checkYouTube(node, mod, site, lesson.file, r); break;
      default: break;
    }
    // Generic references, whichever component carries them (NumberDrill/Order/LocalTask `exercise`, TraceTable
    // and hand-written CodeSample `sample`, `<MemoryDiagram trace="id">`).
    if (name !== 'Exercise') {
      const ex = str(attr(node, 'exercise').value);
      if (ex) checkExerciseRef(ex, mod, site, r, at);
    }
    if (name === 'CodeSample' || name === 'TraceTable' || name === 'PredictRun') {
      const s = str(attr(node, 'sample').value);
      if (s) checkSampleRef(s, mod, site, r, at, name === 'TraceTable', `<${name}>`);
      else if (name === 'CodeSample' && !hasSpread(node)) {
        r.error(at, 'sample-ref', '<CodeSample> is generated from a ```c fence (id=…): write the fence, or pass sample="<id>" to show an existing sample');
      }
    }
    if (name === 'MemoryDiagram') {
      const t = str(attr(node, 'trace').value);
      if (t) checkSampleRef(t, mod, site, r, at, true, '<MemoryDiagram trace>');
    }
  }
  return { cards: cards.length, maxWords: Math.max(0, ...wordCounts), words: wordCounts };
}

/** After every lesson of a module has been checked: the per-module video limit. */
export function checkModuleVideos(mod: ModuleCtx, rep: Collector): void {
  if (mod.videosUsed.size <= MAX_VIDEOS_PER_MODULE) return;
  const uses = [...mod.videosUsed.entries()];
  const [key, where] = uses[MAX_VIDEOS_PER_MODULE];
  rep.at(where.file, mod.id).error(where.line, 'video-limit',
    `module ${mod.id} uses ${mod.videosUsed.size} different videos (${uses.map(u => u[0]).join(', ')}); the limit is ${MAX_VIDEOS_PER_MODULE}. Remove "${key}" or drop a clip`);
}

