// Conceptual multiple-choice check (no code to run, so the answer is authored).
import { useId, useState } from 'react';
import { useCardDone } from '../lesson/LessonContext';
import { MiniMarkdown } from '../components/MiniMarkdown';
import { Mark } from '../components/Icon';
import styles from './Interaction.module.css';

export function Choice({ question, options, answer, explain, why }: {
  question: string;
  options: string[];
  answer: number;
  /** Shown after answering. */
  explain?: string;
  /** Optional per-option feedback, same order as options. */
  why?: string[];
}) {
  const name = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState<number | null>(null);
  const markDone = useCardDone();
  const correct = submitted === answer;
  return (
    <div className={styles.box} data-interaction="choice">
      <div className={styles.kicker}>Check your understanding</div>
      <form onSubmit={e => { e.preventDefault(); if (picked !== null) { setSubmitted(picked); markDone(); } }} className={styles.predict}>
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
          <button type="submit" className="btn btn-primary" disabled={picked === null}>{submitted === null ? 'Check' : 'Check again'}</button>
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
