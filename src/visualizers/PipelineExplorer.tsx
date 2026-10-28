// V7 Pipeline Explorer: the same source at each stage of the build, produced live by the in-browser clang. Source,
// preprocessor (-E) and assembly (-S) are the default; an MDX `stages="…"` attribute adds the relocatable object
// (objdump -t and objdump -d -l), its nm symbols and the link step. The stored native panes are a later layer.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { getRuntime, type StageResult } from '../runtime/CRuntime';
import type { Stage } from '../runtime/flags';
import { CodeListing } from '../components/CodeListing';
import { ToolchainProgress } from '../components/ToolchainProgress';
import { DiagnosticsList } from '../components/DiagnosticsList';
import { nestedSample } from '../interactions/nested';
import ix from '../interactions/Interaction.module.css';
import styles from './PipelineExplorer.module.css';

type Tab = 'source' | Stage;

const TABS: Record<Tab, { label: string; blurb: string }> = {
  source: { label: 'Your source', blurb: 'What you wrote.' },
  E: { label: 'After the preprocessor', blurb: 'Every #include is pasted in and every macro expanded. This is what the compiler proper actually reads.' },
  S: { label: 'Assembly (WebAssembly)', blurb: 'The compiler’s output for your browser’s “CPU”. A real machine gets x86-64 or arm64 instructions instead (Module 10).' },
  'objdump-t': { label: 'Object file: symbols', blurb: 'The compiler’s -c output is a relocatable object. objdump -t lists its symbol table: the names the linker can use, and the ones it must find elsewhere.' },
  'objdump-d': { label: 'Object file: instructions', blurb: 'objdump -d -l disassembles the object. Each instruction is labelled with the source line it came from.' },
  nm: { label: 'nm: defined and undefined', blurb: 'nm is the short version: one line per symbol. T and D are defined here; U is undefined. The linker usually resolves a U from another object or library, but some — like __stack_pointer — are made by wasm-ld itself.' },
  link: { label: 'Link', blurb: 'wasm-ld joins the object with the C library into a runnable main.wasm. A missing symbol fails here, not in the compiler.' },
};

/** The default tabs: exactly the three lesson 1.1 shows. */
export const DEFAULT_STAGES = 'source,E,S';

/** Parse the `stages` attribute: source first, then the known names in the author's order. */
export function parseStages(stages?: string): Tab[] {
  const out: Tab[] = ['source'];
  for (const name of (stages ?? DEFAULT_STAGES).split(',')) {
    const t = name.trim() as Tab;
    if (t !== 'source' && Object.hasOwn(TABS, t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/** A tab's label carries its position among the tabs on screen, so `stages="E,nm"` reads 1, 2, 3. */
const tabLabel = (tabs: Tab[], t: Tab): string => `${tabs.indexOf(t) + 1}. ${TABS[t].label}`;

export function PipelineExplorer({ children, code: codeProp, stages }: { children?: ReactNode; code?: string; stages?: string }) {
  const nested = nestedSample(children);
  const code = nested?.code ?? codeProp ?? '';
  const tabs = parseStages(stages);
  const name = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selected, setSelected] = useState<Tab>('source');
  const [out, setOut] = useState<Partial<Record<Stage, StageResult>>>({});
  const [busy, setBusy] = useState(false);
  const tab = tabs.includes(selected) ? selected : tabs[0];
  const sel = tabs.indexOf(tab);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outRef = useRef(out);
  outRef.current = out;

  const stopTimer = () => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => stopTimer, []);

  const compile = async (t: Tab) => {
    if (t === 'source' || outRef.current[t]?.ok) return; // a failed stage (for example, no compiler) is tried again
    setBusy(true);
    const r = await getRuntime().stage({ 'main.c': code }, t);
    outRef.current = { ...outRef.current, [t]: r };
    setOut(o => ({ ...o, [t]: r }));
    setBusy(false);
  };
  // A click compiles at once; arrow keys select at once but defer the compile briefly, so arrowing across the tabs
  // starts one compile (the tab it settles on), not one per tab passed.
  const open = (t: Tab) => { stopTimer(); setSelected(t); void compile(t); };
  const select = (t: Tab) => {
    stopTimer();
    setSelected(t);
    if (t === 'source' || outRef.current[t]?.ok) return;
    timer.current = setTimeout(() => { timer.current = null; void compile(t); }, 150);
  };

  // The tab pattern: arrow keys move selection and focus, Home and End jump; Tab leaves the tab list.
  const onKeyDown = (e: KeyboardEvent) => {
    const n = tabs.length;
    // Arrow keys move relative to the focused tab, as the tab pattern expects (the selected tab when focus is outside).
    const focused = tabRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    const from = focused >= 0 ? focused : sel;
    const next = ({ ArrowRight: (from + 1) % n, ArrowLeft: (from - 1 + n) % n, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
    select(tabs[next]);
  };

  const current = tab === 'source' ? null : out[tab];
  const text = tab === 'source' ? code : current?.text ?? '';
  const lineCount = text ? text.replace(/\n$/, '').split('\n').length : 0;
  const label = tabLabel(tabs, tab);
  // A failed stage's message is already in the diagnostics box: do not print the same text again below it.
  const duplicate = Boolean(current && !current.ok && text.trim() && text === current.raw);
  return (
    <div className={styles.box} aria-label="Pipeline explorer">
      <div className={ix.kicker}>Pipeline explorer · live in your browser</div>
      <div role="tablist" className={`${ix.tabs} ${styles.tabs}`} aria-label="Compilation stage" onKeyDown={onKeyDown}>
        {tabs.map((t, i) => (
          <button
            key={t} ref={el => { tabRefs.current[i] = el; }} type="button" role="tab" id={`${name}-tab-${i}`} aria-controls={`${name}-panel`}
            aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} className={ix.tab} onClick={() => void open(t)}
          >{tabLabel(tabs, t)}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${name}-panel`} aria-labelledby={`${name}-tab-${sel}`}>
        <p className={ix.muted}>{TABS[tab].blurb} {lineCount > 0 && <strong>{lineCount} {lineCount === 1 ? 'line' : 'lines'}.</strong>}</p>
        {(busy || (current && !current.ok)) && <ToolchainProgress />}
        {busy && <p className={ix.muted}>Running clang…</p>}
        {current && !current.ok && <DiagnosticsList diagnostics={current.diagnostics} raw={current.raw} title={tab === 'link' ? 'Linker messages' : undefined} />}
        {!busy && text && !duplicate && (
          <div className={styles.scroll} role="region" aria-label={`${label} output`} tabIndex={0}>
            <CodeListing code={lineCount > 1500 ? text.split('\n').slice(-1500).join('\n') : text} label={label} />
          </div>
        )}
      </div>
    </div>
  );
}
