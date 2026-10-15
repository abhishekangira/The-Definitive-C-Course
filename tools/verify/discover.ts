// Finds every C sample in the course content:
//   content/modules/<mNN-…>/lessons/*.mdx      ```c / ```h fences (mdast `code` nodes)
//   content/modules/<mNN-…>/quizzes/*.yaml     items with `code` and type predict|outcome|choice|ce|md|sp
// The same unified/remark parser the site uses, so extraction can't disagree with rendering.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';
import type { Code, Root } from 'mdast';
import { parse as parseYaml } from 'yaml';
import { parseFenceMeta, type ExtMeta } from './meta';
import type { SampleMeta } from '../../src/content-model/types';

export interface DiscoveredSample {
  id: string;
  module: string; // "m01"
  moduleDir: string; // "m01-c-in-your-browser"
  lesson: string; // lesson file stem, or "quiz:<file stem>"
  file: string; // path relative to the content root's parent (for messages)
  line: number;
  code: string;
  /** The fence meta string as written (part of the cache key). */
  metaString: string;
  meta: SampleMeta;
  ext: ExtMeta;
}

export interface DiscoveredFragment {
  id: string;
  module: string;
  lesson: string;
  file: string;
  line: number;
  code: string;
  partial: boolean;
}

export interface Discovery {
  samples: DiscoveredSample[];
  fragments: DiscoveredFragment[];
  errors: string[];
  /** Every module id found (even when filtered out). */
  modules: string[];
}

const MODULE_RE = /^(m\d{2}|cap)(?:-|$)/;

export function moduleIdOf(dir: string): string | null {
  return MODULE_RE.exec(dir)?.[1] ?? null;
}

const mdxParser = unified().use(remarkParse).use(remarkMdx).use(remarkFrontmatter, ['yaml']);

/** C fences in one MDX document. */
export function extractMdxFences(text: string): Array<{ lang: string; meta: string; code: string; line: number }> {
  const tree = mdxParser.parse(text) as Root;
  const out: Array<{ lang: string; meta: string; code: string; line: number }> = [];
  visit(tree, 'code', (node: Code) => {
    const lang = node.lang ?? '';
    if (lang !== 'c' && lang !== 'h') return;
    // Samples always end with a newline, like a file on disk.
    out.push({ lang, meta: node.meta ?? '', code: node.value.endsWith('\n') ? node.value : node.value + '\n', line: node.position?.start.line ?? 0 });
  });
  return out;
}

interface QuizItem {
  id?: string;
  type?: string;
  code?: string;
  meta?: string;
  choices?: Array<string | { text?: string; label?: string }>;
}

// ce (compiler-error reading) and md/sp (memory diagrams, steppers) items are verified for what they show
// (diagnostics, traces) but ask nothing about the program's output, so there is no prediction to check.
const QUIZ_PREDICT: Record<string, SampleMeta['predict']> = { predict: 'output', outcome: 'outcome', choice: 'choice', ce: 'none', md: 'none', sp: 'none' };

function quizItems(doc: unknown): QuizItem[] {
  if (Array.isArray(doc)) return doc as QuizItem[];
  if (doc && typeof doc === 'object') {
    for (const k of ['items', 'pool', 'questions']) {
      const v = (doc as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as QuizItem[];
    }
  }
  return [];
}

/** Line of `id: <id>` in the YAML text (for messages); 0 when not found. */
function yamlLineOf(text: string, id: string): number {
  const i = text.split('\n').findIndex(l => new RegExp(`^\\s*-?\\s*id:\\s*["']?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*$`).test(l));
  return i + 1;
}

export interface DiscoverOptions {
  /** Directory that contains modules/ (default: <repo>/content). */
  contentRoot: string;
  /** Only return samples of this module id (errors and duplicate checks still cover everything). */
  module?: string;
}

export function discover(o: DiscoverOptions): Discovery {
  const result: Discovery = { samples: [], fragments: [], errors: [], modules: [] };
  const modulesDir = path.join(o.contentRoot, 'modules');
  if (!existsSync(modulesDir)) return result;
  const seen = new Map<string, string>();
  const rel = (f: string) => path.relative(path.dirname(o.contentRoot), f);

  for (const moduleDir of readdirSync(modulesDir).sort()) {
    const full = path.join(modulesDir, moduleDir);
    if (!statSync(full).isDirectory()) continue;
    const module = moduleIdOf(moduleDir);
    if (!module) { result.errors.push(`${rel(full)}: module directory must start with mNN- (or cap-)`); continue; }
    result.modules.push(module);
    const keep = !o.module || o.module === module;
    // With --module, only that module's problems are reported (duplicate ids are still global).
    const error = (msg: string) => { if (keep) result.errors.push(msg); };

    const add = (s: DiscoveredSample) => {
      const prev = seen.get(s.id);
      if (prev) result.errors.push(`${s.file}:${s.line}: duplicate sample id "${s.id}" (also at ${prev})`);
      else seen.set(s.id, `${s.file}:${s.line}`);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(s.id)) error(`${s.file}:${s.line}: sample id "${s.id}" must be lower-case kebab-case (it names a file)`);
      if (keep) result.samples.push(s);
    };

    const lessonsDir = path.join(full, 'lessons');
    if (existsSync(lessonsDir)) {
      for (const f of readdirSync(lessonsDir).filter(f => f.endsWith('.mdx')).sort()) {
        const file = path.join(lessonsDir, f);
        const lesson = f.replace(/\.mdx$/, '');
        let fences;
        try { fences = extractMdxFences(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')); } catch (err) {
          error(`${rel(file)}: MDX parse error: ${(err as Error).message}`);
          continue;
        }
        for (const fence of fences) {
          const where = `${rel(file)}:${fence.line}`;
          let parsed;
          try { parsed = parseFenceMeta(fence.meta); } catch (err) { error(`${where}: ${(err as Error).message}`); continue; }
          if (!parsed.meta) { error(`${where}: C fence needs id=… (a runnable sample) or fragment (an illustration)`); continue; }
          if (parsed.meta.fragment) {
            if (keep) result.fragments.push({ id: parsed.meta.id, module, lesson, file: rel(file), line: fence.line, code: fence.code, partial: parsed.ext.fragmentPartial });
            continue;
          }
          add({ id: parsed.meta.id, module, moduleDir, lesson, file: rel(file), line: fence.line, code: fence.code, metaString: fence.meta, meta: parsed.meta, ext: parsed.ext });
        }
      }
    }

    const quizDir = path.join(full, 'quizzes');
    if (existsSync(quizDir)) {
      for (const f of readdirSync(quizDir).filter(f => /\.ya?ml$/.test(f)).sort()) {
        const file = path.join(quizDir, f);
        const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        let doc: unknown;
        try { doc = parseYaml(text); } catch (err) { error(`${rel(file)}: YAML parse error: ${(err as Error).message}`); continue; }
        const lesson = `quiz:${f.replace(/\.ya?ml$/, '')}`;
        for (const item of quizItems(doc)) {
          if (typeof item?.code !== 'string' || !item.type || !(item.type in QUIZ_PREDICT)) continue;
          const line = item.id ? yamlLineOf(text, item.id) : 0;
          const where = `${rel(file)}:${line}`;
          if (!item.id) { error(`${where}: quiz item with code needs an id`); continue; }
          const metaString = `id=${item.id} ${item.meta ?? ''}`.trim();
          let parsed;
          try { parsed = parseFenceMeta(metaString); } catch (err) { error(`${where}: ${(err as Error).message}`); continue; }
          if (!parsed.meta || parsed.meta.fragment) { error(`${where}: quiz code must be a runnable sample`); continue; }
          const meta: SampleMeta = { ...parsed.meta, predict: QUIZ_PREDICT[item.type] };
          if (item.choices) meta.choices = item.choices.map(c => (typeof c === 'string' ? c : String(c.text ?? c.label ?? '')));
          const code = item.code.endsWith('\n') ? item.code : item.code + '\n';
          add({ id: item.id, module, moduleDir, lesson, file: rel(file), line, code, metaString, meta, ext: parsed.ext });
        }
      }
    }
  }
  return result;
}
