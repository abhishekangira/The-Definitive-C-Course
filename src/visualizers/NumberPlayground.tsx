// V1 Number Playground: one bit pattern, read as unsigned, signed (two's complement), hex and binary.
import { useId, useState } from 'react';
import { asSigned, asUnsigned, binary, ctype, hex, limits, mask, parseNumber, toBits, type Width } from './numbers';
import styles from './NumberPlayground.module.css';

export function NumberPlayground({ value = 42, width = 8, signed = true }: { value?: number; width?: Width; signed?: boolean }) {
  const [bits, setBits] = useState<bigint>(toBits(BigInt(value), width));
  const [w, setW] = useState<Width>(width);
  const [isSigned, setSigned] = useState(signed);
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');
  const id = useId();

  const setFromText = (t: string) => {
    setText(t);
    const v = parseNumber(t);
    if (v === null) { setError('Enter a decimal, 0x… hex or 0b… binary number.'); return; }
    const [lo, hi] = limits(w, isSigned);
    setError(v < lo || v > hi ? `Out of range for ${ctype(w, isSigned)} (${lo} … ${hi}); it wraps to the bit pattern below.` : '');
    setBits(toBits(v, w));
  };
  const toggle = (i: number) => { const nb = bits ^ (1n << BigInt(i)); setBits(nb); setText(String(isSigned ? asSigned(nb, w) : asUnsigned(nb, w))); setError(''); };
  const changeWidth = (nw: Width) => { setW(nw); setBits(b => b & mask(nw)); };

  const s = asSigned(bits, w);
  const u = asUnsigned(bits, w);
  return (
    <div className={styles.box} aria-label="Number playground">
      <div className={styles.head}>
        <span className={styles.title}>Number playground</span>
        <label>Width <select value={w} onChange={e => changeWidth(Number(e.target.value) as Width)}>{[8, 16, 32, 64].map(x => <option key={x} value={x}>{x} bits</option>)}</select></label>
        <label><input type="checkbox" checked={isSigned} onChange={e => setSigned(e.target.checked)} /> signed</label>
      </div>
      <label className={styles.entry} htmlFor={`${id}-v`}>Type a number:
        <input id={`${id}-v`} value={text} onChange={e => setFromText(e.target.value)} spellCheck={false} />
      </label>
      {error && <p className={styles.note} role="status">{error}</p>}
      <div className={styles.bits} role="group" aria-label={`The ${w} bits; click a bit to flip it`}>
        {Array.from({ length: w }, (_, k) => w - 1 - k).map(i => {
          const on = Boolean((bits >> BigInt(i)) & 1n);
          return (
            <button key={i} type="button" className={`${styles.bit} ${on ? styles.on : ''} ${i === w - 1 && isSigned ? styles.sign : ''}`}
              aria-pressed={on} aria-label={`bit ${i}${i === w - 1 && isSigned ? ' (sign bit)' : ''}: ${on ? 1 : 0}`} onClick={() => toggle(i)}>
              {on ? 1 : 0}
            </button>
          );
        })}
      </div>
      <dl className={styles.reads}>
        <div><dt>Binary</dt><dd><code>{binary(bits, w)}</code></dd></div>
        <div><dt>Hex</dt><dd><code>{hex(bits, w)}</code></dd></div>
        <div><dt>As <code>{ctype(w, false)}</code></dt><dd><code>{u.toString()}</code></dd></div>
        <div><dt>As <code>{ctype(w, true)}</code></dt><dd><code>{s.toString()}</code></dd></div>
      </dl>
    </div>
  );
}
