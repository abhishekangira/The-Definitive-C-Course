// The Playground: a free C editor. No quiz, no gating and no progress is recorded; it uses the same in-browser
// clang, flags and runtime as the lessons. The draft (code, input, arguments) is kept in this browser.
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CodeEditor, preloadCodeEditor } from '../../components/CodeEditor';
import { DiagnosticsList } from '../../components/DiagnosticsList';
import { Icon } from '../../components/Icon';
import { Terminal } from '../../components/Terminal';
import { STORAGE_PREFIX, useProgress } from '../../progress/store';
import { getRuntime } from '../../runtime/CRuntime';
import { useCRun, useToolchainState } from '../../runtime/useCRun';
import ix from '../../interactions/Interaction.module.css';
import styles from './Playground.module.css';

interface Example { id: string; label: string; code: string; stdin?: string }

export const EXAMPLES: Example[] = [
  {
    id: 'hello', label: 'Hello',
    code: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello from C!\\n");\n    return 0;\n}\n',
  },
  {
    id: 'input', label: 'Read input', stdin: '2\n40\n',
    code: '#include <stdio.h>\n#include "learnc.h"\n\nint main(void) {\n    int a = get_int("First number: ");\n    int b = get_int("Second number: ");\n    printf("%d + %d = %d\\n", a, b, a + b);\n    return 0;\n}\n',
  },
  {
    id: 'sizes', label: 'Type sizes',
    code: '#include <stdio.h>\n\nint main(void) {\n    printf("char      %zu\\n", sizeof(char));\n    printf("int       %zu\\n", sizeof(int));\n    printf("long      %zu\\n", sizeof(long));\n    printf("long long %zu\\n", sizeof(long long));\n    printf("pointer   %zu\\n", sizeof(void *));\n    return 0;\n}\n',
  },
  {
    id: 'array', label: 'Array loop',
    code: '#include <stdio.h>\n\nint main(void) {\n    int scores[] = {90, 72, 85};\n    int n = (int)(sizeof scores / sizeof scores[0]);\n    int total = 0;\n    for (int i = 0; i < n; i++) {\n        total += scores[i];\n    }\n    printf("average = %.1f\\n", (double)total / n);\n    return 0;\n}\n',
  },
  {
    id: 'empty', label: 'Empty program',
    code: 'int main(void) {\n    return 0;\n}\n',
  },
];

interface Draft { code: string; stdin: string; args: string; guardrail: boolean }

const KEY = `${STORAGE_PREFIX}playground`;
const FRESH: Draft = { code: EXAMPLES[0].code, stdin: '', args: '', guardrail: false };

function loadDraft(): Draft {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Draft> | null;
    if (o && typeof o.code === 'string') {
      return { code: o.code, stdin: typeof o.stdin === 'string' ? o.stdin : '', args: typeof o.args === 'string' ? o.args : '', guardrail: o.guardrail === true };
    }
  } catch { /* storage blocked or the saved text is not ours: start fresh */ }
  return FRESH;
}

/** The draft shares the browser's storage quota with the learner's progress, so a huge paste must not be kept. */
const MAX_SAVED_CHARS = 200_000;

/** False when the draft is too big to keep (nothing is written then). */
function saveDraft(d: Draft): boolean {
  const text = JSON.stringify({ version: 1, ...d });
  if (text.length > MAX_SAVED_CHARS) return false;
  try { localStorage.setItem(KEY, text); } catch { /* storage blocked: the draft lives only while the tab is open */ }
  return true;
}

export function PlaygroundPage() {
  const [draft, setDraft] = useState(loadDraft);
  const { code, stdin, args, guardrail } = draft;
  // Only a draft this tab has edited is saved, so opening the page in a second tab never overwrites newer work.
  const dirty = useRef(false);
  const [kept, setKept] = useState(true);
  const set = (patch: Partial<Draft>) => { dirty.current = true; setDraft(d => ({ ...d, ...patch })); };
  const stdinId = useId();
  const argsId = useId();
  const runner = useCRun();
  const toolchain = useToolchainState();
  const lowMemory = Boolean(useProgress().settings.storedOutputMode);
  const busy = runner.phase === 'compiling' || runner.phase === 'running' || runner.phase === 'waiting-input';

  // Save shortly after the last edit, and again when the tab is hidden or closed or the page is left.
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => setKept(saveDraft(latest.current)), 300);
    return () => window.clearTimeout(t);
  }, [draft]);
  useEffect(() => {
    const save = () => { if (dirty.current) saveDraft(latest.current); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') save(); };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVisibility);
      save();
    };
  }, []);

  // The learner came here to run code: load the editor and warm the compiler now (never in low-memory mode).
  useEffect(() => {
    preloadCodeEditor();
    if (!lowMemory) getRuntime().prefetch();
  }, [lowMemory]);

  // Both the Run button and Ctrl/Cmd+Enter in the editor call this, so it reads the latest state through a ref.
  const doRun = () => {
    const d = latest.current;
    if (lowMemory || busy) return;
    const words = d.args.trim() === '' ? [] : d.args.trim().split(/\s+/);
    void runner.run({
      files: { 'main.c': d.code },
      // Typed input is fed to the program as is; with none, the program can wait for typing in the terminal.
      stdin: d.stdin !== '' ? d.stdin : undefined,
      args: words,
      guardrail: d.guardrail,
    });
  };
  const runRef = useRef(doRun);
  runRef.current = doRun;

  const load = (ex: Example) => {
    const untouched = EXAMPLES.some(e => e.code === code && (e.stdin ?? '') === stdin);
    if (!untouched && !window.confirm('Replace your code with this example?')) return;
    set({ code: ex.code, stdin: ex.stdin ?? '' });
    runner.reset();
  };

  return (
    <div className={styles.page}>
      <div>
        <h1>Playground</h1>
        <p className={styles.eyebrow}>Nothing here counts toward your progress</p>
        <p className={styles.lede}>Write any C program and run it. It is compiled by clang right in your browser, the same compiler the lessons use.</p>
      </div>

      {lowMemory && (
        <p className={ix.warn} role="status" id="playground-low-memory">
          Low-memory mode is on, so the compiler is never downloaded and the playground can't run your code.
          {' '}Turn it off in <Link to="/settings">Settings</Link> to use it.
        </p>
      )}

      <div className={styles.examples} role="group" aria-label="Examples">
        <span className={styles.examplesLabel}>Start from:</span>
        {EXAMPLES.map(ex => <button key={ex.id} type="button" className="btn btn-sm" onClick={() => load(ex)} disabled={busy}>{ex.label}</button>)}
      </div>

      <CodeEditor value={code} onChange={v => set({ code: v })} onRun={() => runRef.current()} label="C source (main.c)" minLines={14} diagnostics={runner.diagnostics} />

      <div className={ix.actions}>
        <button type="button" className="btn btn-primary" onClick={doRun} aria-disabled={busy || lowMemory} aria-describedby={lowMemory ? 'playground-low-memory' : undefined}><Icon name="play" /> Run</button>
        <span className={ix.muted}>or press <kbd className={styles.kbd}>Ctrl</kbd>+<kbd className={styles.kbd}>Enter</kbd> (<kbd className={styles.kbd}>Cmd</kbd>+<kbd className={styles.kbd}>Enter</kbd> on a Mac) in the editor</span>
        <label className={styles.check}>
          <input type="checkbox" checked={guardrail} onChange={e => set({ guardrail: e.target.checked })} />
          Stop on undefined behavior (UBSan)
        </label>
      </div>

      <div className={styles.options}>
        <div className={ix.field}>
          <label htmlFor={stdinId}>Input for the program (stdin)</label>
          <textarea id={stdinId} aria-describedby={`${stdinId}-help`} value={stdin} onChange={e => set({ stdin: e.target.value })} rows={3} spellCheck={false} className={ix.mono} />
          <span id={`${stdinId}-help`} className={styles.help}>Leave this empty to type input in the terminal while the program runs. Anything here is fed to the program instead.</span>
        </div>
        <div className={ix.field}>
          <label htmlFor={argsId}>Command-line arguments</label>
          <input id={argsId} aria-describedby={`${argsId}-help`} type="text" value={args} onChange={e => set({ args: e.target.value })} spellCheck={false} className={ix.mono} placeholder="separated by spaces" />
          <span id={`${argsId}-help`} className={styles.help}>Separated by spaces; quote marks are not interpreted. Passed to <code>main</code> as <code>argv[1]</code>, <code>argv[2]</code>, and so on.</span>
        </div>
      </div>

      {!kept && <p className={ix.muted} role="status">This program is too big to keep in this browser between visits, so it will be lost when you close the tab.</p>}
      {/* The log and status regions below only exist once something ran; this one announces a failed compile. */}
      <p className="visually-hidden" role="status">
        {runner.phase === 'done' && runner.result === null && toolchain.status !== 'error'
          ? `Compilation failed with ${runner.diagnostics.filter(d => d.severity === 'error' || d.severity === 'fatal error').length} error(s). The messages are below the editor.`
          : ''}
      </p>

      {runner.phase !== 'idle' && (
        <>
          <DiagnosticsList diagnostics={runner.diagnostics} raw={runner.rawDiagnostics} />
          <Terminal segments={runner.segments} phase={runner.phase} result={runner.result} onStop={runner.stop} onInput={runner.sendInput} onEOF={runner.sendEOF} label="Program output" />
        </>
      )}

      <details className={styles.details}>
        <summary>What gets compiled</summary>
        <p>
          One file, <code>main.c</code>, built by clang 22 for WebAssembly (wasm32) with <code>-std=c17 -Wall -Wextra -pedantic -O0 -g</code>, then run in a sandbox: 5 seconds of CPU time, 256 MiB of memory, 1 MiB of output, and an in-memory <code>/tmp</code> folder that vanishes when the program ends.
          You can <code>#include</code> the standard library and the course helper <code>"learnc.h"</code> (<code>get_int</code>, <code>get_line</code> and friends). Because this is 32-bit WebAssembly,
          {' '}<code>long</code> and pointers are 4 bytes here, while most computers use 8. There are no threads or sockets.
        </p>
      </details>
    </div>
  );
}
