// V7 Pipeline Explorer (basic): the same source after preprocessing (-E) and as WebAssembly assembly (-S),
// produced live by the in-browser clang.
import { useState, type ReactNode } from 'react';
import { getRuntime, type StageResult } from '../runtime/CRuntime';
import { CodeListing } from '../components/CodeListing';
import { ToolchainProgress } from '../components/ToolchainProgress';
import { DiagnosticsList } from '../components/DiagnosticsList';
import { nestedSample } from '../interactions/nested';
import ix from '../interactions/Interaction.module.css';
import styles from './PipelineExplorer.module.css';

type Tab = 'source' | 'E' | 'S';
const TABS: Array<{ key: Tab; label: string; blurb: string }> = [
  { key: 'source', label: '1. Your source', blurb: 'What you wrote.' },
  { key: 'E', label: '2. After the preprocessor', blurb: 'Every #include is pasted in and every macro expanded. This is what the compiler proper actually reads.' },
  { key: 'S', label: '3. Assembly (WebAssembly)', blurb: 'The compiler’s output for your browser’s “CPU”. A real machine gets x86-64 or arm64 instructions instead (Module 10).' },
];

export function PipelineExplorer({ children, code: codeProp }: { children?: ReactNode; code?: string }) {
  const nested = nestedSample(children);
  const code = nested?.code ?? codeProp ?? '';
  const [tab, setTab] = useState<Tab>('source');
  const [out, setOut] = useState<Partial<Record<Tab, StageResult>>>({});
  const [busy, setBusy] = useState(false);

  const open = async (t: Tab) => {
    setTab(t);
    if (t === 'source' || out[t]) return;
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
      <div role="tablist" className={ix.tabs} aria-label="Compilation stage">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={ix.tab} onClick={() => void open(t.key)}>{t.label}</button>
        ))}
      </div>
      <p className={ix.muted}>{TABS.find(t => t.key === tab)!.blurb} {lineCount > 0 && <strong>{lineCount} lines.</strong>}</p>
      {busy && <ToolchainProgress />}
      {busy && <p className={ix.muted}>Running clang…</p>}
      {current && !current.ok && <DiagnosticsList diagnostics={current.diagnostics} raw={current.raw} />}
      {!busy && text && (
        <div className={styles.scroll}>
          <CodeListing code={lineCount > 1500 ? text.split('\n').slice(-1500).join('\n') : text} label={TABS.find(t => t.key === tab)!.label} />
        </div>
      )}
    </div>
  );
}
