// Inline SVG icons. The client spec forbids Unicode glyphs as icons (check marks, crosses, play triangles, arrows): most UI
// fonts lack them or draw them at a different size. Icons here are decorative by default: the words next to them ("Correct.", "Next") carry the meaning, so
// the SVG is hidden from assistive technology. Give `label` only when the icon stands alone.
import type { ReactNode } from 'react';

export type IconName =
  | 'check' | 'cross' | 'minus'
  | 'arrow-left' | 'arrow-right' | 'arrow-up' | 'arrow-down'
  | 'indent' | 'outdent' | 'restart' | 'play' | 'flame';

const PATHS: Record<IconName, ReactNode> = {
  check: <path d="M3 8.5l3.2 3.2L13 4.5" />,
  cross: <path d="M4 4l8 8M12 4l-8 8" />,
  minus: <path d="M4 8h8" />,
  'arrow-left': <path d="M13 8H3M7 4L3 8l4 4" />,
  'arrow-right': <path d="M3 8h10M9 4l4 4-4 4" />,
  'arrow-up': <path d="M8 13V3M4 7l4-4 4 4" />,
  'arrow-down': <path d="M8 3v10M4 9l4 4 4-4" />,
  indent: <path d="M2 3h12M8 6.5h6M8 9.5h6M2 13h12M2.5 6L5 8l-2.5 2" />,
  outdent: <path d="M2 3h12M8 6.5h6M8 9.5h6M2 13h12M5 6L2.5 8 5 10" />,
  restart: <path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3" />,
  play: <path d="M5 3l8 5-8 5z" fill="currentColor" stroke="none" />,
  flame: <path d="M8 1C9 3.5 12.5 5 12.5 9.3 12.5 12.4 10.5 15 8 15 5.5 15 3.5 12.4 3.5 9.3 3.5 7.6 4.3 6.4 5.2 5.4 5.5 6.6 6.2 7.3 7 7.5 6.6 5.2 7 2.8 8 1Z" fill="currentColor" stroke="none" />,
};

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg
      className="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      focusable="false" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The right/wrong mark that sits before a verdict such as "Correct." or "Not quite." */
export function Mark({ ok }: { ok: boolean }) {
  return <Icon name={ok ? 'check' : 'cross'} />;
}
