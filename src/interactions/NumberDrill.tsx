// NP: a conversion drill. The answer is computed, not authored.
import { useId, useState } from 'react';
import { asSigned, asUnsigned, binary, ctype, floatDrillBits, floatFromBits, floatText, hex, parseNumber, toBits, type Width } from '../visualizers/numbers';
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

/** Reads a learner's decimal answer ("1", "-2.5", "Infinity"); null when it is not a number. */
function parseDecimal(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (/^[-+]?inf(inity)?$/.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(t) ? Number(t) : null;
}

export function NumberDrill({ kind = 'int', ...props }: {
  value: number | string;
  kind?: 'int' | 'float';
  from?: Base;
  to?: Base;
  width?: Width;
  signed?: boolean;
  prompt?: string;
  onResult?: (correct: boolean) => void;
}) {
  return kind === 'float' ? <FloatDrill {...props} /> : <IntDrill {...props} />;
}

/** Decode (`from="hex" to="dec"`) or encode (`from="dec" to="hex"`) a 32-bit float. */
function FloatDrill({ value, from = 'hex', to = 'dec', prompt, onResult }: { value: number | string; from?: Base; to?: Base; prompt?: string; onResult?: (correct: boolean) => void }) {
  const bits = floatDrillBits(value);
  const decode = from === 'hex';
  const number = floatFromBits(bits, 32);
  const question = decode ? hex(bits, 32) : floatText(bits, 32);
  const answer = decode ? floatText(bits, 32) : hex(bits, 32);
  const [given, setGiven] = useState('');
  const [result, setResult] = useState<boolean | null>(null);
  const markDone = useCardDone();
  const id = useId();
  const check = () => {
    const ok = decode
      ? parseDecimal(given) === number
      : (() => { const g = parseNumber(/^0x/i.test(given.trim()) ? given : `0x${given}`); return g !== null && g === bits; })();
    if (result === null) onResult?.(ok);
    setResult(ok);
    markDone();
  };
  return (
    <div className={styles.box} data-interaction="number-drill" data-kind="float" data-value={String(value)} data-from={from} data-to={to} data-width={32} data-signed="true">
      <div className={styles.kicker}>Convert</div>
      <p className={styles.prompt}>{prompt ?? (decode
        ? <>Decode <code>{question}</code> as a 32-bit <code>float</code>. What number is it? (Write it in decimal.)</>
        : <>Write <code>{question}</code> as the bit pattern of a 32-bit <code>float</code>, in hexadecimal.</>)}</p>
      <form className={styles.actions} onSubmit={e => { e.preventDefault(); check(); }}>
        <label htmlFor={id} className="visually-hidden">Your answer in {NAME[to]}</label>
        <input id={id} className={styles.mono} value={given} onChange={e => { setGiven(e.target.value); setResult(null); }} placeholder={decode ? '' : '0x…'} spellCheck={false}
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

function IntDrill({ value, from = 'dec', to = 'bin', width = 8, signed = false, prompt, onResult }: {
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
