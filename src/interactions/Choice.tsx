// Conceptual multiple-choice check (no code to run, so the answer is authored).
import { useEffect, useId, useRef, useState } from 'react';
import { useCardDone, useLesson, usePredictionShown } from '../lesson/LessonContext';
import { choiceKey, update } from '../progress/store';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { Mark } from '../components/Icon';
import styles from './Interaction.module.css';

export function Choice({ question, options, answer, explain, why, qid }: {
  question: string;
  options: string[];
  answer: number;
  /** Shown after answering. */
  explain?: string;
  /** Optional per-option feedback, same order as options. */
  why?: string[];
  /** Its place among the lesson's questions, added by remark-course. The first submission is saved under it (perfect lessons). */
  qid?: string;
}) {
  const name = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState<number | null>(null);
  const markDone = useCardDone();
  const lesson = useLesson();
  const scored = usePredictionShown();
  const box = useRef<HTMLDivElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const [shownTick, setShownTick] = useState(0);
  // After the verdict is in the DOM (like a prediction's reveal), so a perfect-lesson check sees this answer saved.
  useEffect(() => {
    if (shownTick === 0) return;
    const focus = submitButton.current?.isConnected ? submitButton.current : box.current;
    if (focus) scored?.(focus);
  }, [shownTick, scored]);
  const submit = (choice: number) => {
    setSubmitted(choice);
    if (lesson && qid !== undefined) {
      const key = choiceKey(lesson.lessonId, qid);
      // Only the first submission counts; "Check again" never rewrites it.
      update(p => { if (!Object.hasOwn(p.choices, key)) p.choices[key] = { picked: choice, correct: choice === answer, at: new Date().toISOString() }; });
    }
    markDone();
    setShownTick(t => t + 1);
  };
  const correct = submitted === answer;
  return (
    <div ref={box} tabIndex={-1} className={styles.box} data-interaction="choice" data-qid={qid}>
      <div className={styles.kicker}>Check your understanding</div>
      <form onSubmit={e => { e.preventDefault(); if (picked !== null) submit(picked); }} className={styles.predict}>
        <fieldset className={styles.choices}>
          <legend><MiniMarkdown text={question} /></legend>
          {options.map((o, i) => {
            const state = submitted === null ? '' : i === answer ? styles.choiceRight : i === submitted ? styles.choiceWrong : '';
            return (
              <label key={i} className={`${styles.choice} ${state}`} data-correct={submitted === null ? undefined : String(i === answer)}>
                <input type="radio" name={name} checked={picked === i} onChange={() => setPicked(i)} />
                <span><MiniMarkdown text={o} />{submitted !== null && why?.[i] && (i === submitted || i === answer) && <span className={styles.muted}> {why[i]}</span>}</span>
              </label>
            );
          })}
        </fieldset>
        <div className={styles.actions}>
          <button ref={submitButton} type="submit" className="btn btn-primary" disabled={picked === null}>{submitted === null ? 'Check' : 'Check again'}</button>
        </div>
      </form>
      {submitted !== null && (
        <div className={correct ? styles.good : styles.bad} role="status">
          <strong><Mark ok={correct} /> {correct ? 'Correct.' : 'Not quite.'}</strong>
          {explain && <MiniMarkdown text={explain} />}
        </div>
      )}
    </div>
  );
}
