// V1 Number Playground: one bit pattern, read as unsigned, signed (two's complement), hex and binary.
// `mode` picks the view: "int" (the bit toggler, default), "wheel" (the two's-complement / overflow wheel)
// and "float" (the IEEE 754 bit editor, with the JavaScript Number line for 64 bits).
import { useId, useState } from 'react';
import {
  asSigned, asUnsigned, binary, ctype, FLOAT_LAYOUT, floatFields, floatFromBits, floatText, floatToBits, hex, jsNumberText, limits, mask,
  parseNumber, toBits, wheelAngle, wheelStep, type FloatClass, type FloatWidth, type Width,
} from './numbers';
import styles from './NumberPlayground.module.css';

export interface NumberPlaygroundProps {
  value?: number;
  width?: Width;
  signed?: boolean;
  mode?: 'int' | 'wheel' | 'float';
}

export function NumberPlayground({ mode = 'int', ...props }: NumberPlaygroundProps) {
  if (mode === 'wheel') return <WheelPlayground value={props.value ?? 0} width={props.width ?? 8} />;
  if (mode === 'float') return <FloatPlayground value={props.value ?? 1} width={props.width === 64 ? 64 : 32} />;
  return <IntPlayground {...props} />;
}

function IntPlayground({ value = 42, width = 8, signed = true }: { value?: number; width?: Width; signed?: boolean }) {
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

// ---------------------------------------------------------------- wheel

const R = 78;
const CX = 100;
const CY = 100;
const point = (deg: number, r: number) => [CX + r * Math.sin((deg * Math.PI) / 180), CY - r * Math.cos((deg * Math.PI) / 180)] as const;

/** A ring of 2^width patterns: 0 at the top, going clockwise; the right half reads as >= 0 when signed. */
function WheelPlayground({ value, width }: { value: number; width: Width }) {
  const [bits, setBits] = useState<bigint>(toBits(BigInt(value), width));
  const [note, setNote] = useState('');
  const u = asUnsigned(bits, width);
  const s = asSigned(bits, width);
  const maxU = mask(width);
  const step = (delta: number) => {
    const next = wheelStep(bits, delta, width);
    const wrapped = delta > 0 ? next < bits : next > bits;
    const crossed = asSigned(next, width) < 0n !== asSigned(bits, width) < 0n && !wrapped;
    setBits(next);
    setNote(
      wrapped ? `Unsigned wrapped: ${u} ${delta > 0 ? '+' : '-'} 1 is ${asUnsigned(next, width)} (defined in C).`
      : crossed ? `The sign bit changed: the same pattern now reads ${asSigned(next, width)} when signed. For a signed int, C leaves overflow undefined.`
      : '',
    );
  };
  const [x, y] = point(wheelAngle(bits, width), R);
  const [x0, y0] = point(0, R);
  const [x1, y1] = point(180, R);
  const marks: Array<[number, bigint]> = [[0, 0n], [90, 1n << BigInt(width - 2)], [180, 1n << BigInt(width - 1)], [270, 3n << BigInt(width - 2)]];
  return (
    <div className={styles.box} data-view="wheel" data-width={width} aria-label={`${width}-bit wheel`}>
      <div className={styles.head}><span className={styles.title}>{width}-bit wheel</span></div>
      <svg className={styles.wheel} viewBox="0 0 200 200" role="img"
        aria-label={`A ring of ${2 ** Math.min(width, 30)}${width > 30 ? '+' : ''} bit patterns. The marker is at ${u} as an unsigned number, ${s} as a signed number.`}>
        <path className={styles.arcPos} d={`M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`} />
        <path className={styles.arcNeg} d={`M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x0} ${y0}`} />
        {marks.map(([deg, b]) => {
          const [tx, ty] = point(deg, R + 16);
          const [ix, iy] = point(deg, R - 18);
          return (
            <g key={deg}>
              <text x={ix} y={iy - 2} textAnchor="middle" className={styles.tickU}>{asUnsigned(b, width).toString()}</text>
              <text x={tx} y={ty + 4} textAnchor="middle" className={styles.tickS}>{asSigned(b, width).toString()}</text>
            </g>
          );
        })}
        <circle cx={x} cy={y} r="7" className={styles.marker} />
        <text x={CX} y={CY - 4} textAnchor="middle" className={styles.centre}>{u.toString()}</text>
        <text x={CX} y={CY + 14} textAnchor="middle" className={styles.centreS}>signed {s.toString()}</text>
      </svg>
      <div className={styles.actions}>
        <button type="button" className="btn" onClick={() => step(-1)}>Subtract 1</button>
        <button type="button" className="btn btn-primary" onClick={() => step(1)}>Add 1</button>
        <button type="button" className="btn" onClick={() => { setBits(toBits(BigInt(value), width)); setNote(''); }}>Reset</button>
      </div>
      <dl className={styles.reads}>
        <div><dt>As <code>{ctype(width, false)}</code> (0 to {maxU.toString()})</dt><dd><code data-read="unsigned">{u.toString()}</code></dd></div>
        <div><dt>As <code>{ctype(width, true)}</code></dt><dd><code data-read="signed">{s.toString()}</code></dd></div>
        <div><dt>Bits</dt><dd><code>{binary(bits, width)}</code></dd></div>
      </dl>
      <p className={styles.note} role="status">{note || 'Press a button: the counter goes round the ring, and the end meets the start.'}</p>
    </div>
  );
}

// ---------------------------------------------------------------- float editor

const CLASS_NAME: Record<FloatClass, string> = { zero: 'zero', subnormal: 'subnormal', normal: 'normal', infinity: 'infinity', nan: 'NaN (not a number)' };

function FloatPlayground({ value, width }: { value: number; width: FloatWidth }) {
  const L = FLOAT_LAYOUT[width];
  const [bits, setBits] = useState<bigint>(floatToBits(value, width));
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');
  const id = useId();
  const f = floatFields(bits, width);
  const typeName = width === 32 ? 'float' : 'double';

  const setFromText = (t: string) => {
    setText(t);
    const clean = t.trim().toLowerCase();
    const v = clean === 'nan' ? NaN : clean === 'inf' || clean === 'infinity' ? Infinity : clean === '-inf' || clean === '-infinity' ? -Infinity : clean === '' ? NaN : Number(clean);
    if (Number.isNaN(v) && clean !== 'nan') { setError('Enter a number such as 0.1, -2.5, 1e10, inf or nan.'); return; }
    const nb = floatToBits(v, width);
    setError(width === 32 && Number.isFinite(v) && floatFromBits(nb, 32) !== v ? `A float cannot hold ${t.trim()} exactly. The nearest float is ${floatText(nb, 32)}.` : '');
    setBits(nb);
  };
  const flip = (index: number) => {
    const nb = bits ^ (1n << BigInt(index));
    setBits(nb);
    setText(floatText(nb, width));
    setError('');
  };
  const group = (label: string, from: number, count: number, name: string) => (
    <div className={styles.field} role="group" aria-label={`${label}: ${count} bits; press a bit to flip it`}>
      <div className={styles.fieldName}>{label}</div>
      <div className={styles.bits}>
        {Array.from({ length: count }, (_, k) => from + count - 1 - k).map(i => {
          const on = Boolean((bits >> BigInt(i)) & 1n);
          return (
            <button key={i} type="button" className={`${styles.bit} ${styles.smallBit} ${on ? styles.on : ''}`} aria-pressed={on}
              aria-label={`${name} bit ${i - from}: ${on ? 1 : 0}`} onClick={() => flip(i)}>{on ? 1 : 0}</button>
          );
        })}
      </div>
    </div>
  );
  const e = f.exponent;
  const decoded =
    f.cls === 'normal' ? `(-1)^${f.sign} x 2^(${e} - ${L.bias}) x (1 + fraction / 2^${L.fractionBits})`
    : f.cls === 'subnormal' ? `(-1)^${f.sign} x 2^${f.unbiased} x (fraction / 2^${L.fractionBits}); there is no hidden 1`
    : f.cls === 'zero' ? `zero (sign ${f.sign}: ${f.sign ? 'minus' : 'plus'} zero)`
    : f.cls === 'infinity' ? 'exponent all ones, fraction zero: infinity'
    : 'exponent all ones, fraction not zero: not a number';
  return (
    <div className={styles.box} data-view="float" data-width={width} aria-label={`${width}-bit float editor`}>
      <div className={styles.head}><span className={styles.title}>{width}-bit {typeName} editor</span></div>
      <label className={styles.entry} htmlFor={`${id}-v`}>Type a number:
        <input id={`${id}-v`} value={text} onChange={e2 => setFromText(e2.target.value)} spellCheck={false} />
      </label>
      {error && <p className={styles.note} role="status">{error}</p>}
      <div className={styles.fields}>
        {group('sign', width - 1, 1, 'sign')}
        {group(`exponent (${L.exponentBits} bits)`, L.fractionBits, L.exponentBits, 'exponent')}
        {group(`fraction (${L.fractionBits} bits)`, 0, L.fractionBits, 'fraction')}
      </div>
      <dl className={styles.reads}>
        <div><dt>Value</dt><dd><code data-read="value">{floatText(bits, width)}</code></dd></div>
        <div><dt>Kind</dt><dd data-read="class">{CLASS_NAME[f.cls]}</dd></div>
        <div><dt>Sign, exponent, fraction</dt><dd><code data-read="fields">{f.sign}, {e}{f.unbiased !== null ? ` (${f.unbiased})` : ''}, 0x{f.fraction.toString(16).toUpperCase()}</code></dd></div>
        <div><dt>Whole pattern</dt><dd><code data-read="hex">{hex(bits, width)}</code></dd></div>
        {width === 64 && <div><dt>As a JavaScript <code>Number</code></dt><dd><code data-read="js">{jsNumberText(bits)}</code></dd></div>}
      </dl>
      <p className={styles.note}>{decoded}</p>
    </div>
  );
}
