// Parsons orderings. The canonical order is solution.c, one block line per non-blank line. Authors
// may list more accepted orderings in exercise.yaml (parsons.accepted); every accepted ordering is
// compiled and tested, and the scrambled starter must not be one of them.

/** Non-blank lines, trimmed: the unit Parsons compares. */
export function blockLines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l !== '');
}

const key = (lines: string[]) => lines.join('\n');

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const count = new Map<string, number>();
  for (const l of a) count.set(l, (count.get(l) ?? 0) + 1);
  for (const l of b) {
    const n = count.get(l);
    if (!n) return false;
    count.set(l, n - 1);
  }
  return true;
}

export interface ParsonsPlan {
  /** Accepted orderings as programs ready to compile (canonical first). */
  programs: Array<{ label: string; code: string }>;
  errors: string[];
  /** The starter's order without distractors, when starter.c exists. */
  starterOrder?: string[];
}

/**
 * Builds the accepted programs. An alternative ordering reuses solution.c's own lines (with their
 * indentation), so it compiles exactly like the canonical one.
 */
export function planParsons(solution: string, accepted: string[] = [], distractors: string[] = [], starter?: string): ParsonsPlan {
  const errors: string[] = [];
  const canonical = blockLines(solution);
  const originals = solution.split('\n').filter(l => l.trim() !== '');
  const programs = [{ label: 'canonical order (solution.c)', code: solution }];
  const seen = new Set([key(canonical)]);

  accepted.forEach((alt, i) => {
    const lines = blockLines(alt);
    if (!sameMultiset(lines, canonical)) { errors.push(`parsons.accepted[${i}] is not a reordering of solution.c's lines`); return; }
    if (seen.has(key(lines))) { errors.push(`parsons.accepted[${i}] repeats an ordering already accepted`); return; }
    seen.add(key(lines));
    const pool = [...originals];
    const code = lines.map(l => pool.splice(pool.findIndex(o => o.trim() === l), 1)[0]).join('\n') + '\n';
    programs.push({ label: `accepted ordering ${i + 1}`, code });
  });

  const canonicalSet = new Set(canonical);
  for (const d of distractors) if (canonicalSet.has(d.trim())) errors.push(`distractor ${JSON.stringify(d)} is also a line of the solution`);

  let starterOrder: string[] | undefined;
  if (starter !== undefined) {
    const distractorSet = new Set(distractors.map(d => d.trim()));
    starterOrder = blockLines(starter).filter(l => !distractorSet.has(l));
    if (!sameMultiset(starterOrder, canonical)) errors.push("starter.c is not a scramble of solution.c's lines (plus distractors)");
    else if (seen.has(key(starterOrder))) errors.push('the scrambled starter.c is already an accepted order');
  }
  return { programs, errors, starterOrder };
}
