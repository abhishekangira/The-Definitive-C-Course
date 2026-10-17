// Ember, the streak pet: a small flame spirit drawn in inline SVG and animated with CSS. Its face follows the streak
// (see src/progress/pet.ts): sad with no streak, worried when today's submission is still missing, happier as the streak grows.
import { useProgress } from '../progress/store';
import { petMessage, petMood, type PetMood } from '../progress/pet';
import { streakStatus } from '../progress/streak';
import { useNow } from './StreakChip';
import styles from './StreakPet.module.css';

const INK = '#1b1d22';

function Sparkle({ x, y, delay }: { x: number; y: number; delay: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path className={styles.sparkle} style={{ animationDelay: delay }} d="M0 -8 L2 -2 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2 -2 Z" fill="#ffd54a" stroke="#9a6b00" strokeWidth="1" strokeLinejoin="round" />
    </g>
  );
}

function Eyes({ mood }: { mood: PetMood }) {
  if (mood === 'ecstatic') {
    // Closed, laughing eyes.
    return <g fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round"><path d="M37 75 Q46 63 55 75" /><path d="M65 75 Q74 63 83 75" /></g>;
  }
  const down = mood === 'sad' ? 4 : 0;
  const up = mood === 'worried' ? -2 : 0;
  const big = mood === 'joyful' ? 1.15 : 1;
  return (
    <g className={styles.eyes}>
      {[46, 74].map(cx => (
        <g key={cx}>
          <ellipse cx={cx} cy={72} rx={8.5 * big} ry={9.5 * big} fill="#ffffff" stroke={INK} strokeWidth="2" />
          <circle cx={cx} cy={72 + down + up} r={4.2 * big} fill={INK} />
          <circle cx={cx + 1.5} cy={72 + down + up - 1.5} r={1.2} fill="#ffffff" />
        </g>
      ))}
    </g>
  );
}

function Face({ mood }: { mood: PetMood }) {
  const stroke = { fill: 'none', stroke: INK, strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  const blush = <g fill="#ff8f8f"><ellipse cx="33" cy="86" rx="6" ry="4" /><ellipse cx="87" cy="86" rx="6" ry="4" /></g>;
  const openMouth = <path d="M46 88 Q60 110 74 88 Z" fill="#5b1a12" stroke={INK} strokeWidth="3" strokeLinejoin="round" />;
  switch (mood) {
    case 'sad':
      return (
        <>
          <Eyes mood={mood} />
          <g {...stroke} strokeWidth={3}><path d="M36 66 L54 58" /><path d="M66 58 L84 66" /></g>
          <path {...stroke} d="M48 97 Q60 85 72 97" />
          <path className={styles.tear} d="M35 82 C32 87 32 92 35 92 C38 92 38 87 35 82 Z" fill="#6ec1ff" stroke="#2f7fb8" strokeWidth="1" />
        </>
      );
    case 'worried':
      return (
        <>
          <Eyes mood={mood} />
          <g {...stroke} strokeWidth={3}><path d="M36 62 L54 55" /><path d="M66 55 L84 62" /></g>
          <path {...stroke} d="M47 94 Q53 89 60 94 T73 94" />
          <path className={styles.sweat} d="M92 46 C89 51 89 56 92 56 C95 56 95 51 92 46 Z" fill="#6ec1ff" stroke="#2f7fb8" strokeWidth="1" />
        </>
      );
    case 'content':
      return <><Eyes mood={mood} /><path {...stroke} d="M50 90 Q60 97 70 90" /></>;
    case 'happy':
      return <><Eyes mood={mood} />{blush}<path {...stroke} d="M45 87 Q60 103 75 87" /></>;
    case 'joyful':
      return <><Eyes mood={mood} />{blush}{openMouth}<Sparkle x={14} y={34} delay="0s" /><Sparkle x={106} y={46} delay="0.5s" /></>;
    case 'ecstatic':
      return (
        <>
          <Eyes mood={mood} />{blush}{openMouth}
          <Sparkle x={12} y={30} delay="0s" /><Sparkle x={108} y={36} delay="0.35s" /><Sparkle x={20} y={96} delay="0.7s" /><Sparkle x={104} y={100} delay="0.2s" />
        </>
      );
  }
}

export function StreakPet({ size = 96, caption = true, className }: { size?: number; caption?: boolean; className?: string }) {
  const st = streakStatus(useProgress().streak, useNow());
  const mood = petMood(st);
  const message = petMessage(st);
  return (
    <figure className={`${styles.pet} ${className ?? ''}`.trim()} data-pet data-mood={mood} style={{ ['--pet-size' as string]: `${size}px` }}>
      <svg className={styles.svg} viewBox="0 0 120 124" role="img" aria-label={`Ember, your streak pet, looks ${mood}.`}>
        <ellipse className={styles.shadow} cx="60" cy="119" rx="28" ry="3.5" />
        <g className={styles.figure}>
          <path className={styles.body} d="M60 8 C68 28 98 44 98 76 C98 100 82 114 60 114 C38 114 22 100 22 76 C22 56 36 46 42 30 C46 38 50 42 54 44 C52 30 54 18 60 8 Z" />
          <Face mood={mood} />
        </g>
      </svg>
      {caption ? <figcaption className={styles.caption}>{message}</figcaption> : <figcaption className="visually-hidden">{message}</figcaption>}
    </figure>
  );
}
