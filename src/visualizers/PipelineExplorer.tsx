// V7 Pipeline Explorer: the same source at each stage of the build. Source, preprocessor (-E) and assembly (-S) are
// produced live by the in-browser clang and are the default; an MDX `stages="…"` attribute adds the relocatable object
// (objdump -t and objdump -d -l), its nm symbols and the link step. `session="<id>"` adds the stored native panes
// (NativePanes.tsx) from a real machine's run, with source-line highlighting.
import { useState, type ReactNode } from 'react';
import { getRuntime, type StageResult } from '../runtime/CRuntime';
import type { Stage } from '../runtime/flags';
import { CodeListing } from '../components/CodeListing';
import { ToolchainProgress } from '../components/ToolchainProgress';
import { DiagnosticsList } from '../components/DiagnosticsList';
import { nestedSample } from '../interactions/nested';
import { NativePanes } from './NativePanes';
import ix from '../interactions/Interaction.module.css';
import styles from './PipelineExplorer.module.css';

type Tab = 'source' | Stage;

const TABS: Record<Tab, { label: string; blurb: string }> = {
  source: { label: '1. Your source', blurb: 'What you wrote.' },
  E: { label: '2. After the preprocessor', blurb: 'Every #include is pasted in and every macro expanded. This is what the compiler proper actually reads.' },
  S: { label: '3. Assembly (WebAssembly)', blurb: 'The compiler’s output for your browser’s “CPU”. A real machine gets x86-64 or arm64 instructions instead (Module 10).' },
  'objdump-t': { label: '4. Object file: symbols', blurb: 'The compiler’s -c output is a relocatable object. objdump -t lists its symbol table: the names the linker can use, and the ones it must find elsewhere.' },
  'objdump-d': { label: '5. Object file: instructions', blurb: 'objdump -d -l disassembles the object. Each instruction is labelled with the source line it came from.' },
  nm: { label: '6. nm: defined and undefined', blurb: 'nm is the short version: one line per symbol. T and D are defined here; U is undefined — the linker must find it in another object or library.' },
  link: { label: '7. Link', blurb: 'wasm-ld joins the object with the C library into a runnable main.wasm. A missing symbol fails here, not in the compiler.' },
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

export function PipelineExplorer({ children, code: codeProp, stages, session }: { children?: ReactNode; code?: string; stages?: string; session?: string }) {
  const nested = nestedSample(children);
  const code = nested?.code ?? codeProp ?? '';
  const tabs = parseStages(stages);
  const [selected, setSelected] = useState<Tab>('source');
  const [out, setOut] = useState<Partial<Record<Stage, StageResult>>>({});
  const [busy, setBusy] = useState(false);
  const tab = tabs.includes(selected) ? selected : tabs[0];

  const open = async (t: Tab) => {
    setSelected(t);
    if (t === 'source' || out[t]?.ok) return; // a failed stage (for example, no compiler) is tried again
    setBusy(true);
    const r = await getRuntime().stage({ 'main.c': code }, t);
    setOut(o => ({ ...o, [t]: r }));
    setBusy(false);
  };

  const current = tab === 'source' ? null : out[tab];
  const text = tab === 'source' ? code : current?.text ?? '';
  const lineCount = text ? text.replace(/\n$/, '').split('\n').length : 0;
  return (
    <div className={styles.box} aria-label="Pipeline explorer">
      <div className={ix.kicker}>Pipeline explorer · live in your browser</div>
      <div role="tablist" className={`${ix.tabs} ${styles.tabs}`} aria-label="Compilation stage">
        {tabs.map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={ix.tab} onClick={() => void open(t)}>{TABS[t].label}</button>
        ))}
      </div>
      <p className={ix.muted}>{TABS[tab].blurb} {lineCount > 0 && <strong>{lineCount} lines.</strong>}</p>
      {(busy || (current && !current.ok)) && <ToolchainProgress />}
      {busy && <p className={ix.muted}>Running clang…</p>}
      {current && !current.ok && <DiagnosticsList diagnostics={current.diagnostics} raw={current.raw} title={tab === 'link' ? 'Linker messages' : undefined} />}
      {!busy && text && (
        <div className={styles.scroll}>
          <CodeListing code={lineCount > 1500 ? text.split('\n').slice(-1500).join('\n') : text} label={TABS[tab].label} />
        </div>
      )}
      {session && <NativePanes session={session} code={code} />}
    </div>
  );
}
