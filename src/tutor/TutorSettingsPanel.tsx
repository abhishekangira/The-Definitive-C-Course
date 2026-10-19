// Settings → AI tutor. The key stays in tdcc:v1:tutor. Nothing is fetched until the learner
// accepts the host named in the notice (including "Test connection").
import { useEffect, useRef, useState } from 'react';
import { requestTutorReply, tutorPingMessages } from './client';
import { ConsentNotice } from './ConsentNotice';
import {
  acceptTutorHost, commitTutorDraft, consentCovers, getTutorSettings,
  removeTutorKey, tutorHost, useTutorSettings, type TutorSettings,
} from './settings';
import styles from './Tutor.module.css';

const PROBLEM_TEXT = {
  key: 'That key can\'t be saved (no spaces or control characters). The previous key is still stored.',
  url: 'That URL is not allowed. Use https, or http on localhost only. The previous URL is still stored.',
} as const;

export function TutorSettingsPanel() {
  const saved = useTutorSettings();
  const [draft, setDraft] = useState({ apiKey: saved.apiKey, baseUrl: saved.baseUrl });
  const [problems, setProblems] = useState<Array<'key' | 'url'>>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [askConsent, setAskConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const testButtonRef = useRef<HTMLButtonElement>(null);
  // Accept and decline remove the focused consent button. Point the keyboard at the
  // result once it exists, and at Test connection while the check is still running.
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    if (notice && noticeRef.current) {
      moveFocus.current = false;
      noticeRef.current.focus();
      return;
    }
    if (!askConsent) testButtonRef.current?.focus();
  }, [notice, askConsent]);

  const commit = () => {
    const result = commitTutorDraft(draft);
    setProblems(result.problems);
    if (result.problems.length === 0) {
      setDraft({ apiKey: result.settings.apiKey, baseUrl: result.settings.baseUrl });
    }
    return result;
  };

  const ping = async (settings: TutorSettings) => {
    setBusy(true);
    setNotice(null);
    const result = await requestTutorReply({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      messages: tutorPingMessages(),
    });
    setBusy(false);
    // The model's text is not shown: a connection check only needs to say that it answered.
    setNotice(result.ok ? 'Connected. The key works.' : result.message);
  };

  const testConnection = async () => {
    if (busy) return;
    const { settings, problems: found } = commit();
    if (found.length) return;
    if (!settings.apiKey) { setNotice('Add an API key first.'); setAskConsent(false); return; }
    if (!consentCovers(settings)) { setAskConsent(true); setNotice(null); return; }
    await ping(settings);
  };

  const accept = () => {
    const host = tutorHost(getTutorSettings().baseUrl);
    if (!host) return;
    acceptTutorHost(host);
    moveFocus.current = true;
    setAskConsent(false);
    void ping(getTutorSettings());
  };

  const remove = () => {
    removeTutorKey();
    const next = getTutorSettings();
    setDraft({ apiKey: '', baseUrl: next.baseUrl });
    setProblems([]);
    setAskConsent(false);
    setNotice('Key removed from this browser. The next key asks for permission again.');
  };

  const host = tutorHost(draft.baseUrl) ?? tutorHost(saved.baseUrl);

  return (
    <section className={styles.section} aria-labelledby="tutor-settings-title">
      <h2 id="tutor-settings-title">AI tutor</h2>
      <p className={styles.warn}>The API key is stored in this browser. Any script on this page can read it. Use a key with a spending limit. The course never receives the key.</p>
      <p className={styles.muted}>Optional. After a failed check on a lesson or problem-set exercise you can ask for a nudge. The course chooses the models: it asks OpenRouter to try gpt-oss-120b, Gemini 3.5 Flash-Lite and a free Nemotron model, through Groq, Cerebras, Google AI Studio or NVIDIA. A different base URL has to accept OpenRouter's <code>models</code> and <code>provider</code> fields.</p>
      <label className={styles.field} htmlFor="tutor-key">API key
        <input id="tutor-key" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={draft.apiKey}
          onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))} onBlur={commit} />
      </label>
      <label className={styles.field} htmlFor="tutor-base">Base URL
        <input id="tutor-base" type="text" autoComplete="off" spellCheck={false} value={draft.baseUrl}
          onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))} onBlur={commit} />
      </label>
      {problems.length > 0 && (
        <ul className={`${styles.warn} ${styles.problems}`} role="alert">
          {problems.map(p => <li key={p}>{PROBLEM_TEXT[p]}</li>)}
        </ul>
      )}
      <div className={styles.actions}>
        <button type="button" ref={testButtonRef} className="btn btn-primary" onClick={() => void testConnection()}>{busy ? 'Testing…' : 'Test connection'}</button>
        <button type="button" className="btn" onClick={remove}>Remove key</button>
      </div>
      {askConsent && host && (
        <ConsentNotice host={host} onAccept={accept} onDecline={() => { moveFocus.current = true; setAskConsent(false); setNotice('Nothing was sent.'); }} />
      )}
      {notice && <p ref={noticeRef} tabIndex={-1} className={notice.startsWith('Connected') ? styles.reply : styles.bad} role="status">{notice}</p>}
    </section>
  );
}
