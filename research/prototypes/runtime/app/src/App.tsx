import { useEffect, useMemo, useRef, useState } from 'react';
import { CRuntime, detectStdinMode, parseDiagnostics, type RunHandle } from './runtime/CRuntime';
import type { StdinMode } from './runtime/protocol';

const SAMPLE = `#include <stdio.h>

int main(void) {
    char name[32];
    int age;
    printf("Name: ");
    if (scanf("%31s", name) != 1) return 1;
    printf("Age: ");
    if (scanf("%d", &age) != 1) return 2;
    printf("Hello %s, in 10 years you'll be %d\\n", name, age + 10);
    return 0;
}
`;

type Line = { fd: 0 | 1 | 2 | 3; text: string };   // 0 = echoed input, 3 = system message

let runtimeSingleton: CRuntime | null = null;
const getRuntime = () => (runtimeSingleton ??= new CRuntime());

export function App() {
  const [code, setCode] = useState(SAMPLE);
  const [mode, setMode] = useState<StdinMode>(detectStdinMode());
  const [preset, setPreset] = useState('Ada 36\n');
  const [out, setOut] = useState<Line[]>([]);
  const [diag, setDiag] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [status, setStatus] = useState('idle');
  const [waiting, setWaiting] = useState(false);
  const [input, setInput] = useState('');
  const handle = useRef<RunHandle | null>(null);
  const append = (fd: Line['fd'], text: string) => setOut(o => (o.length && o[o.length - 1].fd === fd ? [...o.slice(0, -1), { fd, text: o[o.length - 1].text + text }] : [...o, { fd, text }]));

  useEffect(() => { (window as any).__app = { getRuntime }; }, []);

  const run = async () => {
    const rt = getRuntime();
    rt.onProgress = (done, total) => setProgress({ done, total });
    setOut([]); setDiag(''); setStatus('compiling');
    const c = await rt.compile(code);
    setDiag(c.diagnostics);
    if (!c.ok) { setStatus(`compile failed (${c.ms.toFixed(0)} ms)`); return; }
    setStatus(`running (compiled in ${c.ms.toFixed(0)} ms)`);
    const h = rt.run(c.wasm!, {
      mode, presetStdin: preset,
      onOutput: append,
      onStdinRequest: () => setWaiting(true),
    });
    handle.current = h;
    const r = await h.done;
    handle.current = null; setWaiting(false);
    const what = r.kind === 'exit' ? `exited with code ${r.exitCode}` : `${r.kind}: ${r.message}${r.hint ? ' — ' + r.hint : ''}`;
    append(3, `\n[${what}]\n`);
    setStatus(`done in ${r.wallMs.toFixed(0)} ms`);
  };

  const send = () => { append(0, input + '\n'); handle.current?.provideInput(input + '\n'); setInput(''); setWaiting(false); };
  const diags = useMemo(() => parseDiagnostics(diag), [diag]);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20 }}>C runtime prototype</h1>
      <textarea id="code" value={code} onChange={e => setCode(e.target.value)} rows={16} style={{ width: '100%', fontFamily: 'monospace' }} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
        <button id="run" onClick={run} disabled={!!handle.current}>Run</button>
        <button id="stop" onClick={() => handle.current?.kill()}>Stop</button>
        <label>stdin:&nbsp;
          <select id="mode" value={mode} onChange={e => setMode(e.target.value as StdinMode)}>
            <option value="jspi">interactive (JSPI)</option>
            <option value="sab">interactive (SharedArrayBuffer)</option>
            <option value="preset">preset text</option>
          </select>
        </label>
        <span id="status">{status}</span>
        <span>crossOriginIsolated={String(globalThis.crossOriginIsolated)} JSPI={String(typeof (WebAssembly as any).Suspending === 'function')}</span>
      </div>
      {progress && progress.done < progress.total && (
        <div>Downloading compiler… <progress id="dl" value={progress.done} max={progress.total} /> {(progress.done / 1e6).toFixed(1)} / {(progress.total / 1e6).toFixed(1)} MB</div>
      )}
      {mode === 'preset' && <textarea id="preset" value={preset} onChange={e => setPreset(e.target.value)} rows={3} style={{ width: '100%' }} placeholder="stdin" />}
      <pre id="diag" style={{ color: '#a60', whiteSpace: 'pre-wrap' }}>{diags.length ? `${diags.filter(d => d.severity === 'warning').length} warning(s), ${diags.filter(d => d.severity.includes('error')).length} error(s)\n` : ''}{diag}</pre>
      <pre id="out" style={{ background: '#111', color: '#ddd', padding: 8, minHeight: 120, whiteSpace: 'pre-wrap' }}>
        {out.map((l, i) => <span key={i} style={{ color: l.fd === 2 ? '#f77' : l.fd === 0 ? '#7cf' : l.fd === 3 ? '#999' : undefined }}>{l.text}</span>)}
      </pre>
      {waiting && (
        <form onSubmit={e => { e.preventDefault(); send(); }}>
          <input id="stdin" autoFocus value={input} onChange={e => setInput(e.target.value)} placeholder="program is waiting for input…" />
          <button type="button" id="eof" onClick={() => { handle.current?.sendEOF(); setWaiting(false); }}>EOF (Ctrl-D)</button>
        </form>
      )}
    </main>
  );
}
