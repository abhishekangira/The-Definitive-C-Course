import { describe, expect, it } from 'vitest';
import { blockLines, planParsons } from './parsons';

const SOLUTION = 'int main(void) {\n    int x = 1;\n    int y = 2;\n\n    return x + y;\n}\n';

describe('planParsons', () => {
  it('uses solution.c as the canonical order and rebuilds alternatives from its own lines', () => {
    const plan = planParsons(SOLUTION, ['int main(void) {\nint y = 2;\nint x = 1;\nreturn x + y;\n}']);
    expect(plan.errors).toEqual([]);
    expect(plan.programs.map(p => p.label)).toEqual(['canonical order (solution.c)', 'accepted ordering 1']);
    expect(plan.programs[0].code).toBe(SOLUTION);
    // Indentation comes from solution.c, so the alternative compiles exactly like the original.
    expect(plan.programs[1].code).toBe('int main(void) {\n    int y = 2;\n    int x = 1;\n    return x + y;\n}\n');
  });
  it('rejects alternatives that are not reorderings, or repeat an accepted order', () => {
    const plan = planParsons(SOLUTION, ['int main(void) {\nint x = 1;\nreturn x;\n}', blockLines(SOLUTION).join('\n')]);
    expect(plan.errors).toEqual([
      "parsons.accepted[0] is not a reordering of solution.c's lines",
      'parsons.accepted[1] repeats an ordering already accepted',
    ]);
  });
  it('checks distractors and the scrambled starter', () => {
    expect(planParsons(SOLUTION, [], ['int x = 1;']).errors).toEqual(['distractor "int x = 1;" is also a line of the solution']);
    expect(planParsons(SOLUTION, [], [], SOLUTION).errors).toEqual(['the scrambled starter.c is already an accepted order']);
    expect(planParsons(SOLUTION, [], [], 'int main(void) {\n}').errors).toEqual(["starter.c is not a scramble of solution.c's lines (plus distractors)"]);
    const ok = planParsons(SOLUTION, [], ['int z;'], '}\nint z;\nint y = 2;\nreturn x + y;\nint x = 1;\nint main(void) {');
    expect(ok.errors).toEqual([]);
    expect(ok.starterOrder).toEqual(['}', 'int y = 2;', 'return x + y;', 'int x = 1;', 'int main(void) {']);
  });
});
