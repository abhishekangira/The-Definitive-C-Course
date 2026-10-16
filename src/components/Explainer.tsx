// <Animation id> — plays a rendered HyperFrames explainer (public/animations/<id>/) in a native <video>:
// captions on by default, step chips, pause-at-step prediction prompts, transcript, and a still-image
// sequence for learners who prefer reduced motion.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Mark } from './Icon';
import styles from './Explainer.module.css';

interface StepsFile {
  id: string;
  title: string;
  duration: number;
  width: number;
  height: number;
  steps: Array<{ key: string; label: string; time: number; end: number }>;
  captions: string;
  poster: string;
  stills?: Record<string, string>;
}

export interface PausePrompt { step: string; question: string; options: string[]; answer: number; explain?: string }

export function Explainer({ id, pauses = [] }: { id: string; pauses?: PausePrompt[] }) {
  const base = `animations/${id}/`;
  const [meta, setMeta] = useState<StepsFile | null | undefined>(undefined);
  const [transcript, setTranscript] = useState<string>('');
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [stills, setStills] = useState(reduced);
  const [stillIndex, setStillIndex] = useState(0);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PausePrompt | null>(null);
  const [answered, setAnswered] = useState<Record<string, number>>({});
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetch(`${base}steps.json`).then(r => (r.ok ? r.json() : null)).then(setMeta).catch(() => setMeta(null));
    fetch(`${base}transcript.txt`).then(r => (r.ok ? r.text() : '')).then(setTranscript).catch(() => {});
  }, [base]);

  const pauseByStep = useMemo(() => new Map(pauses.map(p => [p.step, p])), [pauses]);

  const onTime = () => {
    const v = video.current;
    if (!v || !meta) return;
    const t = v.currentTime;
    const cur = meta.steps.find(s => t >= s.time && t < s.end);
    setActiveStep(cur?.key ?? null);
    // Pause at the end of a step that has a prompt the learner hasn't answered yet.
    for (const s of meta.steps) {
      const p = pauseByStep.get(s.key);
      if (p && answered[s.key] === undefined && t >= s.end - 0.05 && t < s.end + 0.5) {
        v.pause();
        v.currentTime = s.end - 0.05;
        setPrompt(p);
        break;
      }
    }
  };

  if (meta === undefined) return <div className={styles.box}>Loading animation…</div>;
  if (meta === null) return <div className={styles.box} role="alert">Animation <code>{id}</code> hasn't been rendered yet (run <code>npm run anim:render</code>).</div>;

  const seek = (time: number) => { const v = video.current; if (v) { v.currentTime = time + 0.01; void v.play(); } };
  const stillKeys = meta.steps.map(s => s.key);

  return (
    <figure className={styles.box} aria-label={`Animation: ${meta.title}`}>
      <div className={styles.head}>
        <figcaption className={styles.title}>{meta.title}</figcaption>
        <span className={styles.dur}>{Math.round(meta.duration)} s · captions on</span>
        <label className={styles.toggle}><input type="checkbox" checked={stills} onChange={e => setStills(e.target.checked)} /> step-by-step stills</label>
      </div>

      {!stills ? (
        <div className={styles.stage}>
          <video ref={video} controls preload="metadata" playsInline poster={`${base}${meta.poster}`} onTimeUpdate={onTime} className={styles.video}>
            <source src={`${base}${id}.mp4`} type='video/mp4; codecs="avc1.640028"' />
            <source src={`${base}${id}.webm`} type='video/webm; codecs="vp9"' />
            <track kind="captions" src={`${base}${meta.captions}`} srcLang="en" label="English" default />
            Your browser can't play this video. Use the step-by-step stills instead.
          </video>
          {prompt && (
            <div className={styles.prompt} role="dialog" aria-label="Predict before continuing">
              <p className={styles.promptQ}><strong>Pause and predict:</strong> {prompt.question}</p>
              <div className={styles.promptOptions}>
                {prompt.options.map((o, i) => (
                  <button key={i} type="button" className="btn" onClick={() => setAnswered(a => ({ ...a, [prompt.step]: i }))} disabled={answered[prompt.step] !== undefined}>{o}</button>
                ))}
              </div>
              {answered[prompt.step] !== undefined && (
                <>
                  <p className={answered[prompt.step] === prompt.answer ? styles.right : styles.wrong}>
                    <Mark ok={answered[prompt.step] === prompt.answer} /> {answered[prompt.step] === prompt.answer ? 'Right.' : `It's “${prompt.options[prompt.answer]}”.`} {prompt.explain}
                  </p>
                  <button type="button" className="btn btn-primary" onClick={() => { setPrompt(null); void video.current?.play(); }}>Continue</button>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.stills}>
          <img src={`${base}${meta.stills?.[stillKeys[stillIndex]] ?? meta.poster}`} alt={meta.steps[stillIndex]?.label ?? ''} className={styles.video} />
          <div className={styles.stillNav}>
            <button type="button" className="btn btn-sm" onClick={() => setStillIndex(i => Math.max(0, i - 1))} disabled={stillIndex === 0}><Icon name="arrow-left" /> Previous</button>
            <span aria-live="polite">Step {stillIndex + 1} of {meta.steps.length}: {meta.steps[stillIndex]?.label}</span>
            <button type="button" className="btn btn-sm" onClick={() => setStillIndex(i => Math.min(meta.steps.length - 1, i + 1))} disabled={stillIndex >= meta.steps.length - 1}>Next <Icon name="arrow-right" /></button>
          </div>
        </div>
      )}

      {!stills && (
        <ol className={styles.chips} aria-label="Jump to a step">
          {meta.steps.map(s => (
            <li key={s.key}><button type="button" className={`${styles.chip} ${activeStep === s.key ? styles.active : ''}`} onClick={() => seek(s.time)}>{s.label}</button></li>
          ))}
        </ol>
      )}
      {transcript && (
        <details className={styles.transcript}>
          <summary>Transcript</summary>
          <p>{transcript}</p>
        </details>
      )}
    </figure>
  );
}
