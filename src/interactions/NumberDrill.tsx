// NP: a conversion drill. The answer is computed, not authored.
import { useId, useState } from 'react';
import { asSigned, asUnsigned, binary, ctype, hex, parseNumber, toBits, type Width } from '../visualizers/numbers';
import { useCardDone } from '../lesson/LessonContext';
import { Mark } from '../components/Icon';
import styles from './Interaction.module.css';

type Base = 'dec' | 'bin' | 'hex';
const NAME: Record<Base, string> = { dec: 'decimal', bin: 'binary', hex: 'hexadecimal' };

function render(bits: bigint, base: Base, width: Width, signed: boolean): string {
  if (base === 'bin') return '0b' + binary(bits, width, width).replace(/ /g, '');
  if (base === 'hex') return hex(bits, width);
  return (signed ? asSigned(bits, width) : asUnsigned(bits, width)).toString();
}

export function NumberDrill({ value, from = 'dec', to = 'bin', width = 8, signed = false, prompt, onResult }: {
  value: number | string;
  from?: Base;
  to?: Base;
  width?: Width;
  signed?: boolean;
  prompt?: string;
  onResult?: (correct: boolean) => void;
}) {
  const bits = toBits(typeof value === 'string' ? (parseNumber(value) ?? 0n) : BigInt(value), width);
  const question = render(bits, from, width, signed);
  const answer = render(bits, to, width, signed);
  const [given, setGiven] = useState('');
  const [result, setResult] = useState<boolean | null>(null);
  const markDone = useCardDone();
  const id = useId();
  const check = () => {
    const g = parseNumber(to === 'bin' && !/^0b/i.test(given.trim()) ? `0b${given}` : to === 'hex' && !/^0x/i.test(given.trim()) ? `0x${given}` : given);
    const ok = g !== null && toBits(g, width) === bits && (to !== 'dec' || g === parseNumber(answer));
    if (result === null) onResult?.(ok);
    setResult(ok);
    markDone();
  };
  return (
    <div className={styles.box} data-interaction="number-drill" data-value={String(value)} data-from={from} data-to={to} data-width={width} data-signed={String(signed)}>
      <div className={styles.kicker}>Convert</div>
      <p className={styles.prompt}>{prompt ?? <>Write <code>{question}</code> ({NAME[from]}, as a {width}-bit <code>{ctype(width, signed)}</code>) in {NAME[to]}.</>}</p>
      <form className={styles.actions} onSubmit={e => { e.preventDefault(); check(); }}>
        <label htmlFor={id} className="visually-hidden">Your answer in {NAME[to]}</label>
        <input id={id} className={styles.mono} value={given} onChange={e => { setGiven(e.target.value); setResult(null); }} placeholder={to === 'bin' ? '0b…' : to === 'hex' ? '0x…' : ''} spellCheck={false}
          style={{ padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--bg)' }} />
        <button type="submit" className="btn btn-primary" disabled={!given.trim()}>Check</button>
      </form>
      {result !== null && (
        <div className={result ? styles.good : styles.bad} role="status">
          <Mark ok={result} /> {result ? 'Correct.' : <>It's <code>{answer}</code>.</>}
        </div>
      )}
    </div>
  );
}
