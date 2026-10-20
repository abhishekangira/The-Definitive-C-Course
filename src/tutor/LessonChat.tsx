// The lesson chat (PLAN.md §2.6): ask the tutor about the lesson you are reading, with the highlighted passage as the
// subject. Replies stream in. The model gets the lesson text and the whole conversation on every request, because it
// remembers nothing between requests. Model text is rendered with MiniMarkdown, never as HTML. Nothing here is saved:
// closing the tab, or going to another lesson, ends the conversation.
import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Icon } from '../components/Icon';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { streamTutorReply } from './client';
import { ConsentNotice } from './ConsentNotice';
import { buildLessonMessages, EXPLAIN_REQUEST } from './lessonPrompt';
import { acceptTutorHost, getTutorSettings, tutorHost, useTutorSettings } from './settings';
import { tutorSetup } from './setup';
import styles from './LessonChat.module.css';

export const LESSON_CHAT_ID = 'lesson-chat';

export interface LessonChatHandle {
  /** From the selection toolbar. Explain sends at once; Reply puts the passage above the box and waits for a question. */
  ask(action: 'explain' | 'reply', quote: string): void;
}

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  quote?: string;
  /** Why this answer stopped short, in words for the learner. */
  error?: string;
}

/** One line of at most `max` characters, for showing a passage in a small box. */
function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

export function LessonChat({ ref, open, onClose, title, moduleLabel, readLesson }: {
  ref?: Ref<LessonChatHandle>;
  open: boolean;
  onClose: () => void;
  title: string;
  moduleLabel: string;
  /** The lesson as the learner sees it now. Called again on every request. */
  readLesson: () => string;
}) {
  const settings = useTutorSettings();
  const setup = tutorSetup(settings, 'lesson');
  const host = tutorHost(settings.baseUrl);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [quote, setQuote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [declined, setDeclined] = useState(false);
  // The conversation lives in a ref as well, so a request started in the same tick as another change reads the latest.
  const turnsRef = useRef<Turn[]>([]);
  const busyRef = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const alive = useRef(true);
  const pending = useRef<{ text: string; quote: string } | null>(null);
  const focusWanted = useRef<'composer' | 'log' | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const wasOpen = useRef(false);
  const stickToEnd = useRef(true);
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const declinedRef = useRef<HTMLParagraphElement>(null);
  const composerId = useId();
  const hintId = useId();

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abort.current?.abort(); };
  }, []);

  const commit = useCallback((next: Turn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const send = useCallback(async (text: string, quoted: string) => {
    const current = getTutorSettings();
    const question = text.trim();
    if (busyRef.current || question === '' || tutorSetup(current, 'lesson') !== 'ready') return;
    busyRef.current = true;
    setBusy(true);
    stickToEnd.current = true;
    const asked: Turn = { id: nextId.current++, role: 'user', content: question, ...(quoted ? { quote: quoted } : {}) };
    const answer: Turn = { id: nextId.current++, role: 'assistant', content: '' };
    const history = turnsRef.current;
    commit([...history, asked, answer]);
    setStatus('The tutor is answering.');
    const messages = buildLessonMessages({ title, moduleLabel, lessonText: readLesson(), turns: [...history, asked] });
    const controller = new AbortController();
    abort.current = controller;
    // New chat, another lesson or leaving the page abandons this request: whatever it still reports is dropped.
    const live = () => alive.current && abort.current === controller;
    const patch = (change: Partial<Turn>) => {
      if (live()) commit(turnsRef.current.map(t => (t.id === answer.id ? { ...t, ...change } : t)));
    };
    const result = await streamTutorReply({
      baseUrl: current.baseUrl, apiKey: current.apiKey, model: current.model, messages, signal: controller.signal,
      onText: content => patch({ content }),
    });
    if (!live()) return;
    if (result.ok) patch({ content: result.text });
    else if (result.code !== 'aborted') patch({ error: result.message });
    else if (turnsRef.current.find(t => t.id === answer.id)?.content === '') commit(turnsRef.current.filter(t => t.id !== answer.id));
    abort.current = null;
    busyRef.current = false;
    setBusy(false);
    setStatus(result.ok ? 'The tutor has answered.' : result.message);
  }, [title, moduleLabel, readLesson, commit]);

  const newChat = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    busyRef.current = false;
    pending.current = null;
    setBusy(false);
    commit([]);
    setQuote('');
    setDraft('');
    setStatus('Started a new chat.');
    focusWanted.current = 'composer';
    setFocusNonce(n => n + 1);
  }, [commit]);

  useImperativeHandle(ref, () => ({
    ask(action, passage) {
      focusWanted.current = action === 'explain' ? 'log' : 'composer';
      setFocusNonce(n => n + 1);
      setQuote(passage);
      if (action === 'reply') return;
      if (tutorSetup(getTutorSettings(), 'lesson') === 'ready' && !busyRef.current) {
        setQuote('');
        void send(EXPLAIN_REQUEST, passage);
      } else if (tutorSetup(getTutorSettings(), 'lesson') === 'needs-consent') {
        // After the learner accepts the notice the question goes out by itself.
        pending.current = { text: EXPLAIN_REQUEST, quote: passage };
        setQuote('');
      } else {
        // Busy with another answer, or not set up: leave it as a question the learner sends when they can.
        setDraft(d => d || EXPLAIN_REQUEST);
      }
    },
  }), [send]);

  useEffect(() => {
    if (setup !== 'ready') return;
    if (pending.current) {
      const { text, quote: passage } = pending.current;
      pending.current = null;
      void send(text, passage);
    }
  }, [setup, send]);

  // Focus follows what the learner did. Opening the panel or choosing Reply goes to the box; Explain goes to the
  // conversation, where the answer appears. Accepting the notice removes the button that had focus, so it moves on.
  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    const wanted = focusWanted.current;
    focusWanted.current = null;
    if (!open || (!opened && !wanted)) return;
    if (wanted === 'log') logRef.current?.focus();
    else if (setup === 'ready') composerRef.current?.focus();
    else headingRef.current?.focus();
  }, [open, focusNonce, setup]);

  useEffect(() => {
    if (declined) declinedRef.current?.focus();
  }, [declined]);

  useEffect(() => {
    const el = logRef.current;
    if (el && stickToEnd.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const submit = () => {
    const text = draft.trim();
    if (busy || text === '') return;
    const passage = quote;
    setDraft('');
    setQuote('');
    void send(text, passage);
  };
  // A phone's soft keyboard has no Shift, so there Enter is a new line and the Send button sends.
  const touch = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <aside
      id={LESSON_CHAT_ID} className={styles.panel} aria-label="Tutor chat" hidden={!open} data-tutor="lesson-chat"
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <header className={styles.head}>
        <h2 ref={headingRef} tabIndex={-1} className={styles.title}>Ask the tutor</h2>
        <div className={styles.headActions}>
          {turns.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={newChat}>New chat</button>}
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close the tutor chat"><Icon name="cross" /></button>
        </div>
      </header>

      {setup === 'no-key' && <p className={styles.note}>Add an API key in <a href="#/settings">Settings</a> to ask the tutor.</p>}
      {setup === 'needs-model' && <p className={styles.note}>Choose a model in <a href="#/settings">Settings</a> to ask the tutor. The course default models only work through OpenRouter.</p>}
      {setup === 'needs-consent' && host && !declined && (
        <div className={styles.note}>
          <ConsentNotice
            host={host} scope="lesson"
            onAccept={() => { focusWanted.current = pending.current ? 'log' : 'composer'; setFocusNonce(n => n + 1); acceptTutorHost(host, 'lesson'); }}
            onDecline={() => { pending.current = null; setDeclined(true); }}
          />
        </div>
      )}
      {setup === 'needs-consent' && declined && (
        <p ref={declinedRef} tabIndex={-1} className={styles.note}>
          Nothing was sent. <button type="button" className="btn btn-sm" onClick={() => setDeclined(false)}>Show the permission notice</button>
        </p>
      )}

      <div
        ref={logRef} className={styles.log} role="log" aria-live="off" aria-label="Conversation" tabIndex={0} data-tutor="log"
        onScroll={e => { const el = e.currentTarget; stickToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
      >
        {turns.length === 0 && (
          <p className={styles.empty}>
            Highlight text in the lesson and choose Explain or Reply, or type a question below. The tutor reads the parts of this lesson you have reached, not the ones still ahead.
          </p>
        )}
        {turns.map(t => t.role === 'user' ? (
          <article key={t.id} className={styles.you} aria-label="You">
            {t.quote && <blockquote className={styles.quote}>{clip(t.quote, 280)}</blockquote>}
            <p>{t.content}</p>
          </article>
        ) : (
          <article key={t.id} className={styles.tutor} aria-label="Tutor">
            {t.content ? <MiniMarkdown text={t.content} className={styles.reply} /> : !t.error && <p className={styles.muted}>Thinking…</p>}
            {t.error && <p className={styles.bad}>{t.error}</p>}
          </article>
        ))}
      </div>
      <p className="visually-hidden" role="status">{status}</p>

      {setup === 'ready' && (
        <form className={styles.composer} onSubmit={e => { e.preventDefault(); submit(); }}>
          {quote && (
            <div className={styles.replying}>
              <span className={styles.replyingLabel}>Replying to</span>
              <q className={styles.replyingText}>{clip(quote, 160)}</q>
              <button type="button" className="btn btn-sm btn-ghost" aria-label="Remove the quoted text" onClick={() => setQuote('')}><Icon name="cross" /></button>
            </div>
          )}
          <label htmlFor={composerId} className="visually-hidden">Your question</label>
          <textarea
            id={composerId} ref={composerRef} rows={2} value={draft} aria-describedby={hintId}
            placeholder={quote ? 'Ask about the quoted text' : 'Ask about this lesson'}
            onChange={e => setDraft(e.target.value)} onKeyDown={onComposerKey}
          />
          <div className={styles.composerRow}>
            <p id={hintId} className={styles.hint}>{touch ? 'Enter for a new line. Send sends.' : 'Enter to send. Shift+Enter for a new line.'}</p>
            {busy
              ? <button type="button" className="btn" onClick={() => abort.current?.abort()}>Stop</button>
              : <button type="submit" className="btn btn-primary" disabled={draft.trim() === ''}>Send</button>}
          </div>
        </form>
      )}
    </aside>
  );
}
