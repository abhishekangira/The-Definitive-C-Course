// V7's stored native panes: a real machine's -S -g listing, nm and objdump -d -l from src/generated/sessions
// (docs/adr/0005-native-sessions.md). Every line is the tool's own output; selecting a source line highlights the
// instructions its line info maps to, and selecting an instruction selects its source line. Each listing is one tab
// stop: arrow keys move between its lines (no tab stop per line), Enter/Space picks one.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { SessionPlatform } from '../content-model/types';
import { useSessions } from '../lesson/LessonContext';
import { useProgress } from '../progress/store';
import { SESSION_PLATFORM_LABEL, splitPlaceholders } from '../components/transcript-tabs';
import { lineAt, linesFor, mapAsmLines, mapObjdumpLines, type LineMap } from './line-map';
import { NATIVE_VIEWS, nativeTabs, preferredSessionPlatform, viewCommand, type NativeView } from './native-panes';
import ix from '../interactions/Interaction.module.css';
import styles from './PipelineExplorer.module.css';

/** Placeholders from the session normaliser are drawn as placeholders, never as realistic values. */
function LineText({ text }: { text: string }) {
  return <>{splitPlaceholders(text).map((p, i) => p.placeholder ? <span key={i} className={styles.ph} data-placeholder={p.placeholder}>{p.text}</span> : p.text)}</>;
}

const digitsOf = (n: number) => Math.max(3, String(n).length);

/** Arrow keys move focus through one listing's line buttons; the list itself is the tab stop. */
function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-line]')];
  if (!buttons.length) return;
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next: HTMLButtonElement;
  switch (e.key) {
    case 'ArrowDown': next = i < 0 ? buttons[0] : buttons[Math.min(buttons.length - 1, i + 1)]; break;
    case 'ArrowUp': next = i < 0 ? buttons[buttons.length - 1] : buttons[Math.max(0, i - 1)]; break;
    case 'Home': next = buttons[0]; break;
    case 'End': next = buttons[buttons.length - 1]; break;
    default: return;
  }
  e.preventDefault();
  next.focus();
}

/** The source, every line a button (source lines are the selection). */
function SourceListing({ code, selected, onPick, label }: { code: string; selected: number | null; onPick: (line: number) => void; label: string }) {
  const lines = code.replace(/\n$/, '').split('\n');
  const digits = digitsOf(lines.length);
  return (
    <div className={styles.listing} role="region" aria-label={label} tabIndex={0} onKeyDown={onListKeyDown} style={{ '--digits': digits } as CSSProperties}>
      <ol className={styles.lines}>
        {lines.map((line, i) => {
          const n = i + 1;
          return (
            <li key={n} className={`${styles.line} ${selected === n ? styles.mapped : ''}`}>
              <button type="button" className={styles.lineBtn} tabIndex={-1} data-line={n} aria-pressed={selected === n} onClick={() => onPick(n)} aria-label={`Source line ${n}: ${line.trim() || 'blank'}`}>
                <span className={styles.no} aria-hidden="true">{n}</span><span className={styles.code}>{line || ' '}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Stored output: lines that line info maps to a source line are buttons (and highlight when that line is selected). */
function OutputListing({ text, map, selected, onPick, label }: { text: string; map: LineMap | null; selected: number | null; onPick: (line: number) => void; label: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const lines = text.replace(/\n$/, '').split('\n');
  const digits = digitsOf(lines.length);
  // Bring the first highlighted instruction into the listing's own scroll box; never scroll the page.
  useEffect(() => {
    if (!map || selected === null) return;
    const list = listRef.current;
    const first = map.findIndex(v => v === selected);
    const el = first < 0 ? null : list?.querySelector<HTMLElement>(`button[data-line="${first + 1}"]`);
    if (!list || !el) return;
    const box = list.getBoundingClientRect();
    const line = el.getBoundingClientRect();
    if (line.top < box.top) list.scrollTop -= box.top - line.top + 4;
    else if (line.bottom > box.bottom) list.scrollTop += line.bottom - box.bottom + 4;
  }, [selected, map]);
  return (
    <div ref={listRef} className={styles.listing} role="region" aria-label={label} tabIndex={0} onKeyDown={onListKeyDown} style={{ '--digits': digits } as CSSProperties}>
      <ol className={styles.lines}>
        {lines.map((line, i) => {
          const n = i + 1;
          const source = map ? lineAt(map, n) : null;
          const mapped = source !== null && source === selected;
          const body = <><span className={styles.no} aria-hidden="true">{n}</span><span className={styles.code}>{line ? <LineText text={line} /> : ' '}</span></>;
          return (
            <li key={n} className={`${styles.line} ${mapped ? styles.mapped : ''}`}>
              {source !== null
                ? <button type="button" className={styles.lineBtn} tabIndex={-1} data-line={n} aria-pressed={mapped} onClick={() => onPick(source)} aria-label={`Text line ${n} (source line ${source}): ${line.trim() || 'blank'}`}>{body}</button>
                : <span className={styles.linePlain}>{body}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The next tab index for ArrowLeft/Right/Home/End, or null for any other key. */
function navIndex(key: string, i: number, n: number): number | null {
  switch (key) {
    case 'ArrowRight': return (i + 1) % n;
    case 'ArrowLeft': return (i - 1 + n) % n;
    case 'Home': return 0;
    case 'End': return n - 1;
    default: return null;
  }
}

export function NativePanes({ session, code }: { session: string; code: string }) {
  const file = useSessions();
  const progress = useProgress();
  const name = useId();
  const viewRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const platformRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [view, setView] = useState<NativeView>('asm');
  const [picked, setPicked] = useState<SessionPlatform | null>(null);
  const [sourceLine, setSourceLine] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
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
  const stdout = tab?.step.stdout ?? '';
  const stderr = tab?.step.stderr ?? '';
  const text = stdout || stderr;
  const map = useMemo(() => {
    if (!tab || !sameSource || view === 'nm') return null;
    return view === 'asm' ? mapAsmLines(text, sourceName) : mapObjdumpLines(text, sourceName);
  }, [tab, sameSource, view, text, sourceName]);

  if (!file) return <p className={ix.warn} role="alert">The stored native sessions are not loaded on this page.</p>;
  if (!result) return <p className={ix.warn} role="alert">The output of session <code>{session}</code> hasn't been generated yet (run <code>npm run verify</code>).</p>;

  const selectView = (v: NativeView) => { setView(v); setSourceLine(null); setAnnouncement(''); };
  const selectPlatform = (p: SessionPlatform) => { setPicked(p); setSourceLine(null); setAnnouncement(''); };
  const pickSource = (line: number) => {
    setSourceLine(line);
    const count = map ? linesFor(map, line).length : 0;
    setAnnouncement(count
      ? `Line ${line}: ${count} ${view === 'asm' ? 'assembly' : 'disassembly'} line${count === 1 ? '' : 's'} highlighted.`
      : `Line ${line} has no instructions in this listing.`);
  };

  const viewIndex = NATIVE_VIEWS.findIndex(v => v.key === view);
  const platformIndex = tabs.findIndex(t => t.platform === chosen);
  const viewPanelId = `${name}-view-panel`;
  const platformPanelId = `${name}-platform-panel`;
  const viewTabId = (i: number) => `${name}-view-tab-${i}`;
  const platformTabId = (i: number) => `${name}-platform-tab-${i}`;
  const onViewKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = navIndex(e.key, viewIndex, NATIVE_VIEWS.length);
    if (next === null) return;
    e.preventDefault();
    viewRefs.current[next]?.focus();
    selectView(NATIVE_VIEWS[next].key);
  };
  const onPlatformKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = navIndex(e.key, platformIndex, tabs.length);
    if (next === null) return;
    e.preventDefault();
    platformRefs.current[next]?.focus();
    selectPlatform(tabs[next].platform);
  };

  const viewLabel = NATIVE_VIEWS[viewIndex].label;
  const pendingLabels = pending.map(p => SESSION_PLATFORM_LABEL[p]);
  const missingLabels = missingView.map(p => SESSION_PLATFORM_LABEL[p]);
  const hasPlaceholders = /<addr\d+>|<tmp\d+>|<pid>|<dir>|<id>|==PID==|--PID==/.test(text);
  const panes = tab && (
    <div className={styles.panes}>
      {sameSource && view !== 'nm' && (
        <div className={styles.pane}>
          <p className={styles.paneTitle}>Source · select a line</p>
          <SourceListing code={code} selected={sourceLine} onPick={pickSource} label="Source lines" />
        </div>
      )}
      <div className={styles.pane}>
        <p className={styles.paneTitle}>{view === 'asm' ? 'Assembly' : view === 'nm' ? 'Symbols' : 'Disassembly'} <code>{viewCommand(result, tab.platform, view) ?? tab.step.cmd}</code></p>
        {!sameSource && view !== 'nm' && <p className={styles.note}>The stored run is for a different version of this source, so line highlighting is off.</p>}
        <OutputListing text={text} map={map} selected={sourceLine} onPick={pickSource} label={`${viewLabel} for ${tab.label}`} />
        {stdout && stderr && <OutputListing text={stderr} map={null} selected={null} onPick={pickSource} label={`stderr for ${tab.label}`} />}
        {tab.step.exit !== 0 && <p className={styles.note}>Exit status {tab.step.exit}.</p>}
      </div>
    </div>
  );
  return (
    <section className={styles.native} aria-label={`Stored native run of ${session}`} data-native={session}>
      <div className={ix.kicker}>On a real machine · recorded by running these commands</div>
      <div role="tablist" className={`${ix.tabs} ${styles.tabs}`} aria-label="Native view" onKeyDown={onViewKey}>
        {NATIVE_VIEWS.map((v, i) => (
          <button key={v.key} ref={el => { viewRefs.current[i] = el; }} type="button" role="tab" id={viewTabId(i)} aria-controls={viewPanelId}
            aria-selected={view === v.key} tabIndex={view === v.key ? 0 : -1} className={ix.tab} onClick={() => selectView(v.key)}>{v.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={viewPanelId} aria-labelledby={viewTabId(viewIndex)}>
        {tabs.length === 0 && (
          <p className={ix.warn} role="alert">No stored {viewLabel} run for this session{pendingLabels.length ? ` (no stored run for ${pendingLabels.join(' or ')})` : ''}.</p>
        )}
        {tabs.length === 1 && <p className={styles.platform}>{tabs[0].label}</p>}
        {tabs.length > 1 && (
          <div role="tablist" className={`${ix.tabs} ${styles.tabs}`} aria-label="Platform for this stored run" onKeyDown={onPlatformKey}>
            {tabs.map((t, i) => (
              <button key={t.platform} ref={el => { platformRefs.current[i] = el; }} type="button" role="tab" id={platformTabId(i)} aria-controls={platformPanelId}
                aria-selected={t.platform === chosen} tabIndex={t.platform === chosen ? 0 : -1} className={ix.tab} onClick={() => selectPlatform(t.platform)}>{t.label}</button>
            ))}
          </div>
        )}
        {/* Before the panes: a mac learner must see that macOS is missing before a long Linux listing. */}
        {pendingLabels.length > 0 && <p className={styles.note} data-pending={pending.join(' ')}>No stored run for {pendingLabels.join(' or ')}.</p>}
        {missingLabels.length > 0 && <p className={styles.note}>No stored {viewLabel} step for {missingLabels.join(' or ')}.</p>}
        {progress.settings.platform === 'linux-arm' && <p className={styles.note}>No stored run for Linux arm64; the stored panes are Linux/WSL and macOS.</p>}
        {panes && (tabs.length > 1
          ? <div role="tabpanel" id={platformPanelId} aria-labelledby={platformTabId(platformIndex)}>{panes}</div>
          : panes)}
        {hasPlaceholders && <p className={styles.note}>The recorder replaces the session’s folder and number-like values with placeholders such as <code>&lt;dir&gt;</code> and <code>&lt;addrN&gt;</code>; equal placeholders are equal values.</p>}
        <p className="visually-hidden" role="status" data-announce>{announcement}</p>
      </div>
    </section>
  );
}
