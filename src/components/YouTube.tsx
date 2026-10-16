// <YouTube video="yt-1"> — one verified segment from videos.json, embedded from youtube-nocookie.com
// behind a click-to-load facade (no request to YouTube until the learner chooses to watch).
import { useState } from 'react';
import { videoByKey } from '../content-runtime/course';
import { Icon } from './Icon';
import { embedSrc } from './youtube-embed';
import styles from './YouTube.module.css';

const fmt = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;

export function YouTube({ video }: { video: string }) {
  const v = videoByKey(video);
  const [play, setPlay] = useState(false);
  if (!v) return <p role="alert">Unknown video “{video}” (not in videos.json).</p>;
  const src = embedSrc(v);
  if (!src) return <p role="alert">Video “{video}” has an invalid id or time range in videos.json.</p>;
  const length = v.end - v.start;
  return (
    <figure className={styles.box}>
      <div className={styles.frame}>
        {play ? (
          <iframe src={src} title={`${v.title} (${fmt(v.start)}–${fmt(v.end)})`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button type="button" className={styles.facade} onClick={() => setPlay(true)}>
            <span className={styles.play} aria-hidden="true"><Icon name="play" /></span>
            <span className={styles.facadeText}>
              <strong>Watch a {Math.round(length / 60 * 10) / 10}-minute clip</strong>
              <span>{v.title}, {fmt(v.start)}–{fmt(v.end)} · {v.channel}</span>
              <span className={styles.small}>Loads YouTube (privacy-enhanced mode) when you press play.</span>
            </span>
          </button>
        )}
      </div>
      <figcaption className={styles.caption}><strong>Why this clip:</strong> {v.why}</figcaption>
    </figure>
  );
}
