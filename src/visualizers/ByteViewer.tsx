// V2 Byte Viewer (minimal): the bytes of a value in memory order, hexdump style (offset, hex bytes, ASCII column),
// with a little/big-endian switch; or, in UTF-8 mode, the bytes of one code point. Neutral: a card never ends with it.
import { useId, useState } from 'react';
import { asciiColumn, binByte, hexByte, parseCodePoint, toBytes, utf8Bytes, type Endian } from './bytes';
import { hex, limits, parseNumber, toBits, type Width } from './numbers';
import styles from './ByteViewer.module.css';

export interface ByteViewerProps {
  value?: number | string;
  width?: Width;
  endian?: Endian;
  mode?: 'int' | 'utf8';
  /** UTF-8 mode: the starting text (its first code point is shown). */
  text?: string;
  /** Hide the input and the width select (a fixed picture, such as the sizes strip). */
  fixed?: boolean;
}

export function ByteViewer({ mode = 'int', ...p }: ByteViewerProps) {
  return mode === 'utf8' ? <Utf8Bytes text={p.text ?? '€'} fixed={p.fixed} /> : <IntBytes {...p} />;
}

function Dump({ bytes, caption }: { bytes: number[]; caption: string }) {
  return (
    <table className={styles.dump}>
      <caption className="visually-hidden">{caption}</caption>
      <thead><tr><th scope="col">Offset</th><th scope="col">Bytes</th><th scope="col">ASCII</th></tr></thead>
      <tbody>
        {Array.from({ length: Math.ceil(bytes.length / 8) }, (_, row) => {
          const line = bytes.slice(row * 8, row * 8 + 8);
          return (
            <tr key={row}>
              <td><code>{(row * 8).toString(16).padStart(8, '0')}</code></td>
              <td><code data-read="bytes">{line.map(hexByte).join(' ')}</code></td>
              <td><code data-read="ascii">{asciiColumn(line)}</code></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Strip({ bytes, label }: { bytes: number[]; label: (i: number) => string | undefined }) {
  return (
    <ol className={styles.strip} aria-label="The bytes, lowest address first">
      {bytes.map((b, i) => (
        <li key={i} className={styles.cell} data-byte={hexByte(b)}>
          <span className={styles.addr}>address +{i}</span>
          <span className={styles.hexv}>{hexByte(b)}</span>
          <span className={styles.binv}>{binByte(b)}</span>
          {label(i) && <span className={styles.tag}>{label(i)}</span>}
        </li>
      ))}
    </ol>
  );
}

function IntBytes({ value = 0x12345678, width = 32, endian = 'little', fixed }: ByteViewerProps) {
  const [w, setW] = useState<Width>(width);
  const [order, setOrder] = useState<Endian>(endian);
  const [text, setText] = useState(typeof value === 'string' ? value : String(value));
  const [bits, setBits] = useState<bigint>(toBits(typeof value === 'string' ? (parseNumber(value) ?? 0n) : BigInt(value), width));
  const [note, setNote] = useState('');
  const id = useId();
  const setFromText = (t: string) => {
    setText(t);
    const v = parseNumber(t);
    if (v === null) { setNote('Enter a decimal, 0x… hex or 0b… binary number.'); return; }
    const [lo] = limits(w, true);
    const [, hi] = limits(w, false);
    setNote(v < lo || v > hi ? `Out of range for ${w} bits (${lo} … ${hi}); it wraps to the bits shown.` : '');
    setBits(toBits(v, w));
  };
  const bytes = toBytes(bits, w, order);
  const n = bytes.length;
  const tag = (i: number) => (n === 1 ? undefined : (order === 'little' ? i === 0 : i === n - 1) ? 'least significant' : (order === 'little' ? i === n - 1 : i === 0) ? 'most significant' : undefined);
  return (
    <div className={styles.box} data-view="bytes" aria-label="Byte viewer">
      <div className={styles.head}>
        <span className={styles.title}>Byte viewer</span>
        {!fixed && <label>Width <select value={w} onChange={e => { const nw = Number(e.target.value) as Width; setW(nw); setBits(b => toBits(b, nw)); }}>{[8, 16, 32, 64].map(x => <option key={x} value={x}>{x} bits</option>)}</select></label>}
        <div role="group" aria-label="Byte order" className={styles.switch}>
          {(['little', 'big'] as const).map(o => (
            <button key={o} type="button" className={`btn ${order === o ? 'btn-primary' : ''}`} aria-pressed={order === o} onClick={() => setOrder(o)}>{o === 'little' ? 'Little-endian' : 'Big-endian'}</button>
          ))}
        </div>
      </div>
      {!fixed && (
        <label className={styles.entry} htmlFor={`${id}-v`}>Type a number:
          <input id={`${id}-v`} value={text} onChange={e => setFromText(e.target.value)} spellCheck={false} />
        </label>
      )}
      {note && <p className={styles.note} role="status">{note}</p>}
      <p className={styles.value}>The {w}-bit value <code data-read="value">{hex(bits, w)}</code> is stored as:</p>
      <Strip bytes={bytes} label={tag} />
      <Dump bytes={bytes} caption={`The ${n} bytes of ${hex(bits, w)} in ${order}-endian order`} />
    </div>
  );
}

function Utf8Bytes({ text: initial, fixed }: { text: string; fixed?: boolean }) {
  const [text, setText] = useState(initial);
  const id = useId();
  const cp = parseCodePoint(text);
  const bytes = cp === null ? null : utf8Bytes(cp);
  return (
    <div className={styles.box} data-view="utf8" aria-label="UTF-8 byte viewer">
      <div className={styles.head}><span className={styles.title}>UTF-8 bytes</span></div>
      {!fixed && (
        <label className={styles.entry} htmlFor={`${id}-v`}>Type one character (or a code such as U+20AC):
          <input id={`${id}-v`} value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
        </label>
      )}
      {cp === null || bytes === null ? (
        <p className={styles.note} role="status">{cp === null ? 'Type a character to see its bytes.' : 'That is not a character UTF-8 can encode (surrogates and values above U+10FFFF are not).'}</p>
      ) : (
        <>
          <p className={styles.value}>Code point <code data-read="codepoint">U+{cp.toString(16).toUpperCase().padStart(4, '0')}</code> ({cp}) takes <strong data-read="count">{bytes.length}</strong> {bytes.length === 1 ? 'byte' : 'bytes'}:</p>
          <Strip bytes={bytes} label={i => (bytes.length === 1 ? 'starts with 0: ASCII' : i === 0 ? `starts with ${'1'.repeat(bytes.length)}0: ${bytes.length} bytes` : 'starts with 10: continuation')} />
          <Dump bytes={bytes} caption={`The UTF-8 bytes of U+${cp.toString(16).toUpperCase()}`} />
        </>
      )}
    </div>
  );
}
