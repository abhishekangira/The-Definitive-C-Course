// One numbered question: a fieldset whose legend starts with its number ("1. …"). CompilerError and the sp quiz item ask
// every question this way, so a learner sees the same element, style and numbering for each part.
import type { FieldsetHTMLAttributes, ReactNode } from 'react';
import styles from './Interaction.module.css';

export function Question({ n, legend, children, className, ...rest }: { n: number; legend: ReactNode; children?: ReactNode } & FieldsetHTMLAttributes<HTMLFieldSetElement>) {
  return (
    <fieldset className={className ? `${styles.choices} ${className}` : styles.choices} {...rest}>
      <legend>{n}. {legend}</legend>
      {children}
    </fieldset>
  );
}
