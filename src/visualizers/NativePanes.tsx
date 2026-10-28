// V7's stored native panes: a real machine's -S -g listing, nm and objdump -d -l from src/generated/sessions
// (docs/adr/0005-native-sessions.md). Every line is the tool's own output; selecting a source line highlights the
// instructions its line info maps to, and selecting an instruction selects its source line.
import { useMemo, useState, type CSSProperties } from 'react';
import type { SessionPlatform } from '../content-model/types';
import { useSessions } from '../lesson/LessonContext';
import { useProgress } from '../progress/store';
import { SESSION_PLATFORM_LABEL, splitPlaceholders } from '../components/transcript-tabs';
import { lineAt, mapAsmLines, mapObjdumpLines, type LineMap } from './line-map';
import { NATIVE_VIEWS, nativeTabs, preferredSessionPlatform, type NativeView } from './native-panes';
import ix from '../interactions/Interaction.module.css';
import styles from './PipelineExplorer.module.css';

/** Placeholders from the session normaliser are drawn as placeholders, never as realistic values. */
function LineText({ text }: { text: string }) {
  return <>{splitPlaceholders(text).map((p, i) => p.placeholder ? <span key={i} className={styles.ph} data-placeholder={p.placeholder}>{p.text}</span> : p.text)}</>;
}

const digitsOf = (n: number) => Math.max(3, String(n).length);

/** The source, every line a button (source lines are the selection). */
function SourceListing({ code, selected, onPick, label }: { code: string; selected: number | null; onPick: (line: number) => void; label: string }) {
  const lines = code.replace(/\n$/, '').split('\n');
  const digits = digitsOf(lines.length);
  return (
    <ol className={styles.listing} aria-label={label} tabIndex={0} style={{ '--digits': digits } as CSSProperties}>
      {lines.map((line, i) => {
        const n = i + 1;
        return (
          <li key={n} className={`${styles.line} ${selected === n ? styles.mapped : ''}`}>
            <button type="button" className={styles.lineBtn} aria-pressed={selected === n} onClick={() => onPick(n)} aria-label={`Source line ${n}: ${line.trim() || 'blank'}`}>
              <span className={styles.no} aria-hidden="true">{n}</span><span className={styles.code}>{line || ' '}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Stored output: lines that line info maps to a source line are buttons (and highlight when that line is selected). */
function OutputListing({ text, map, selected, onPick, label }: { text: string; map: LineMap | null; selected: number | null; onPick: (line: number) => void; label: string }) {
  const lines = text.replace(/\n$/, '').split('\n');
  const digits = digitsOf(lines.length);
  return (
    <ol className={styles.listing} aria-label={label} tabIndex={0} style={{ '--digits': digits } as CSSProperties}>
      {lines.map((line, i) => {
        const n = i + 1;
        const source = map ? lineAt(map, n) : null;
        const mapped = source !== null && source === selected;
        const body = <><span className={styles.no} aria-hidden="true">{n}</span><span className={styles.code}>{line ? <LineText text={line} /> : ' '}</span></>;
        return (
          <li key={n} className={`${styles.line} ${mapped ? styles.mapped : ''}`}>
            {source !== null
              ? <button type="button" className={styles.lineBtn} aria-pressed={mapped} onClick={() => onPick(source)} aria-label={`Text line ${n} (source line ${source}): ${line.trim() || 'blank'}`}>{body}</button>
              : <span className={styles.linePlain}>{body}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function NativePanes({ session, code }: { session: string; code: string }) {
  const file = useSessions();
  const progress = useProgress();
  const [view, setView] = useState<NativeView>('asm');
  const [picked, setPicked] = useState<SessionPlatform | null>(null);
  const [sourceLine, setSourceLine] = useState<number | null>(null);
  const result = file?.sessions[session];
  const preferred = preferredSessionPlatform(progress.settings.platform);
  const { tabs, pending, missingView } = useMemo(
    () => (result ? nativeTabs(result, view) : { tabs: [], pending: [], missingView: [] }),
    [result, view],
  );
  const chosen = tabs.find(t => t.platform === picked)?.platform
    ?? tabs.find(t => t.platform === preferred)?.platform
    ?? tabs[0]?.platform;
  const tab = tabs.find(t => t.platform === chosen) ?? null;
  const sourceName = result ? (Object.hasOwn(result.sources, 'main.c') ? 'main.c' : Object.keys(result.sources)[0] ?? 'main.c') : 'main.c';
  const source = result?.sources[sourceName] ?? '';
  const sameSource = source.replace(/\n$/, '') === code.replace(/\n$/, '');
  const text = tab ? (tab.step.stdout || tab.step.stderr) : '';
  const map = useMemo(() => {
    if (!tab || !sameSource || view === 'nm') return null;
    return view === 'asm' ? mapAsmLines(text, sourceName) : mapObjdumpLines(text, sourceName);
  }, [tab, sameSource, view, text, sourceName]);

  if (!file) return <p className={ix.warn} role="alert">The stored native sessions are not loaded on this page.</p>;
  if (!result) return <p className={ix.warn} role="alert">The output of session <code>{session}</code> hasn't been generated yet (run <code>npm run verify</code>).</p>;

  const viewLabel = NATIVE_VIEWS.find(v => v.key === view)!.label;
  const pendingLabels = pending.map(p => SESSION_PLATFORM_LABEL[p]);
  const missingLabels = missingView.map(p => SESSION_PLATFORM_LABEL[p]);
  const hasPlaceholders = /<addr\d+>|<tmp\d+>|<pid>|<dir>|<id>|==PID==|--PID--/.test(text);
  return (
    <section className={styles.native} aria-label={`Stored native run of ${session}`} data-native={session}>
      <div className={ix.kicker}>On a real machine · recorded by running these commands</div>
      <div role="tablist" className={`${ix.tabs} ${styles.tabs}`} aria-label="Native view">
        {NATIVE_VIEWS.map(v => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={ix.tab}
            onClick={() => { setView(v.key); setSourceLine(null); }}>{v.label}</button>
        ))}
      </div>
      {tabs.length === 0 && (
        <p className={ix.warn} role="alert">No stored {viewLabel} run for this session{pendingLabels.length ? ` (no stored run for ${pendingLabels.join(' or ')})` : ''}.</p>
      )}
      {tabs.length === 1 && <p className={styles.platform}>{tabs[0].label}</p>}
      {tabs.length > 1 && (
        <div role="tablist" className={`${ix.tabs} ${styles.tabs}`} aria-label="Platform for this stored run">
          {tabs.map(t => (
            <button key={t.platform} type="button" role="tab" aria-selected={t.platform === chosen} className={ix.tab}
              onClick={() => { setPicked(t.platform); setSourceLine(null); }}>{t.label}</button>
          ))}
        </div>
      )}
      {tab && (
        <div className={styles.panes}>
          {sameSource && view !== 'nm' && (
            <div className={styles.pane}>
              <p className={styles.paneTitle}>Source · select a line</p>
              <SourceListing code={code} selected={sourceLine} onPick={setSourceLine} label="Source lines" />
            </div>
          )}
          <div className={styles.pane}>
            <p className={styles.paneTitle}>{view === 'asm' ? 'Assembly' : view === 'nm' ? 'Symbols' : 'Disassembly'} <code>{tab.step.cmd}</code></p>
            {!sameSource && view !== 'nm' && <p className={styles.note}>The stored run is for a different version of this source, so line highlighting is off.</p>}
            <OutputListing text={text} map={map} selected={sourceLine} onPick={setSourceLine} label={`${viewLabel} for ${tab.label}`} />
            {tab.step.stderr && <OutputListing text={tab.step.stderr} map={null} selected={null} onPick={setSourceLine} label={`stderr for ${tab.label}`} />}
            {tab.step.exit !== 0 && <p className={styles.note}>Exit status {tab.step.exit}.</p>}
          </div>
        </div>
      )}
      {hasPlaceholders && <p className={styles.note}>The recorder replaces the session’s folder and number-like values with placeholders such as <code>&lt;dir&gt;</code> and <code>&lt;addrN&gt;</code>; equal placeholders are equal values.</p>}
      {pendingLabels.length > 0 && <p className={styles.note} data-pending={pending.join(' ')}>No stored run for {pendingLabels.join(' or ')}.</p>}
      {missingLabels.length > 0 && <p className={styles.note}>No stored {viewLabel} step for {missingLabels.join(' or ')}.</p>}
      {progress.settings.platform === 'linux-arm' && <p className={styles.note}>No stored run for Linux arm64; the stored panes are Linux/WSL and macOS.</p>}
    </section>
  );
}
