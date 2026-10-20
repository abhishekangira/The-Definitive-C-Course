// Settings → AI tutor. The key stays in tdcc:v1:tutor. Nothing is fetched until the learner
// accepts the host named in the notice (including "Test connection").
import { useEffect, useRef, useState } from 'react';
import { requestTutorReply, tutorPingMessages } from './client';
import { ConsentNotice } from './ConsentNotice';
import {
  SUGGESTED_TUTOR_MODELS, acceptTutorHost, commitTutorDraft, consentCovers, getTutorSettings,
  isOpenRouter, removeTutorKey, tutorHost, useExternalTutorChanges, useTutorSettings, type TutorSettings,
} from './settings';
import styles from './Tutor.module.css';

const PROBLEM_TEXT = {
  key: 'That key can\'t be saved (no spaces or control characters). The previous key is still stored.',
  url: 'That URL is not allowed. Use https, or http on localhost only. The previous URL is still stored.',
} as const;

/** What the form says about a rejected model id depends on what is really stored, so it never claims the tutor is off when it is not. */
function modelProblemText(stored: TutorSettings): string {
  if (stored.model) return `Type a model id with no spaces. The previous model id (${stored.model}) is still used.`;
  if (isOpenRouter(stored.baseUrl)) return 'Type a model id with no spaces. Until you do, the course default models are used.';
  return 'Type a model id with no spaces. Nothing can be asked until a model is chosen.';
}

interface Draft { apiKey: string; baseUrl: string; model: string; useDefaultModel: boolean }

const draftFrom = (s: TutorSettings): Draft => ({ apiKey: s.apiKey, baseUrl: s.baseUrl, model: s.model, useDefaultModel: s.model === '' });

export function TutorSettingsPanel() {
  const saved = useTutorSettings();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved));
  const [problems, setProblems] = useState<Array<'key' | 'url' | 'model'>>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [askConsent, setAskConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const testButtonRef = useRef<HTMLButtonElement>(null);
  // Accept and decline remove the focused consent button. Point the keyboard at the
  // result once it exists, and at Test connection while the check is still running.
  const moveFocus = useRef(false);
  // Another tab changed the settings (Remove key, a new model). Start the form again from the store instead of
  // saving this tab's older draft over it on the next blur.
  const external = useExternalTutorChanges();
  useEffect(() => {
    if (external === 0) return;
    setDraft(draftFrom(getTutorSettings()));
    setProblems([]);
  }, [external]);

  useEffect(() => {
    if (!moveFocus.current) return;
    if (notice && noticeRef.current) {
      moveFocus.current = false;
      noticeRef.current.focus();
      return;
    }
    if (!askConsent) testButtonRef.current?.focus();
  }, [notice, askConsent]);

  // The course default only exists for OpenRouter, so on any other host the learner is choosing their own model.
  // A URL that is still being typed (and not valid yet) is judged by the URL that is stored.
  const onOpenRouter = (baseUrl: string) => isOpenRouter(baseUrl) || (tutorHost(baseUrl) === null && isOpenRouter(saved.baseUrl));
  const usingDefault = (d: Draft) => d.useDefaultModel && onOpenRouter(d.baseUrl);

  const commit = (next: Draft = draft) => {
    const result = commitTutorDraft({ apiKey: next.apiKey, baseUrl: next.baseUrl, model: next.model, useDefaultModel: usingDefault(next) });
    setProblems(result.problems);
    if (result.problems.length === 0) setDraft(draftFrom(result.settings));
    return result;
  };

  const chooseModelMode = (useDefaultModel: boolean) => {
    const next = { ...draft, useDefaultModel };
    setDraft(next);
    // Choosing "my own model id" is not an error yet: the box is empty because the learner has not typed.
    // The id is checked when they leave the box, or press Test connection.
    if (useDefaultModel || next.model.trim() !== '') commit(next);
    else setProblems(p => p.filter(x => x !== 'model'));
  };

  const ping = async (settings: TutorSettings) => {
    setBusy(true);
    setNotice(null);
    const result = await requestTutorReply({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
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
    setDraft(draftFrom(getTutorSettings()));
    setProblems([]);
    setAskConsent(false);
    setNotice('Key removed from this browser. The next key asks for permission again.');
  };

  const host = tutorHost(draft.baseUrl) ?? tutorHost(saved.baseUrl);
  const defaultAvailable = onOpenRouter(draft.baseUrl);
  const defaultChosen = usingDefault(draft);

  return (
    <section className={styles.section} aria-labelledby="tutor-settings-title">
      <h2 id="tutor-settings-title">AI tutor</h2>
      <p className={styles.warn}>The API key is stored in this browser. Any script on this page can read it. Use a key with a spending limit. The course never receives the key.</p>
      <p className={styles.muted}>Optional. After a failed check on a lesson or problem-set exercise you can ask for a nudge. It works with OpenRouter or any other OpenAI-compatible chat API.</p>
      <label className={styles.field} htmlFor="tutor-key">API key
        <input id="tutor-key" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={draft.apiKey}
          onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))} onBlur={() => commit()} />
      </label>
      <label className={styles.field} htmlFor="tutor-base">Base URL
        <input id="tutor-base" type="text" autoComplete="off" spellCheck={false} value={draft.baseUrl}
          onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))} onBlur={() => commit()} />
      </label>
      <fieldset className={styles.group}>
        <legend>Model</legend>
        <label className={styles.choice}>
          <input type="radio" name="tutor-model-mode" checked={defaultChosen} disabled={!defaultAvailable} onChange={() => chooseModelMode(true)} />
          <span>
            Course default
            <span className={styles.muted}> tries gpt-oss-120b, then Gemini 3.5 Flash-Lite, then a free Nemotron model, through Groq, Cerebras, Google AI Studio or NVIDIA.
              {defaultAvailable ? '' : ' It needs the OpenRouter base URL.'}</span>
          </span>
        </label>
        <label className={styles.choice}>
          <input type="radio" name="tutor-model-mode" checked={!defaultChosen} onChange={() => chooseModelMode(false)} />
          <span>My own model id <span className={styles.muted}>(for OpenRouter or any other provider)</span></span>
        </label>
        {!defaultChosen && (
          <label className={styles.field} htmlFor="tutor-model">Model id
            <input id="tutor-model" type="text" list="tutor-model-suggestions" autoComplete="off" spellCheck={false}
              placeholder="for example openai/gpt-4o-mini" value={draft.model}
              onChange={e => setDraft(d => ({ ...d, model: e.target.value }))} onBlur={() => commit()} />
          </label>
        )}
        <datalist id="tutor-model-suggestions">
          {SUGGESTED_TUTOR_MODELS.map(model => <option key={model} value={model} />)}
        </datalist>
        <p className={styles.muted}>The suggested ids are examples, not a promise that the provider still serves them.</p>
      </fieldset>
      {problems.length > 0 && (
        <ul className={`${styles.warn} ${styles.problems}`} role="alert">
          {problems.map(p => <li key={p}>{p === 'model' ? modelProblemText(saved) : PROBLEM_TEXT[p]}</li>)}
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
