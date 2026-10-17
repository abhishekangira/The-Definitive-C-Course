import { describe, expect, it } from 'vitest';
import { addDay, emptyStreak, streakStatus, type StreakStatus } from './streak';
import { FORMS, formFor, formRank, isFormId, nextForm, reachedForms, transformationFrom, warriorMessage, warriorMood } from './warrior';

const status = (over: Partial<StreakStatus>): StreakStatus => ({ current: 0, longest: 0, state: 'none', lastDay: null, beans: 1, gapSaved: 0, saved: [], ...over });
const active = (current: number) => status({ state: 'active', current, longest: current, lastDay: '2026-03-10' });

describe('forms', () => {
  it('are reached at 1, 3, 7, 14, 30 and 50 days, in this order', () => {
    expect(FORMS.map(f => [f.id, f.at])).toEqual([['kid', 1], ['warrior', 3], ['golden', 7], ['mane', 14], ['crimson', 30], ['ape', 50]]);
  });

  it('formFor steps up exactly at each threshold', () => {
    const at = (n: number) => formFor(n).id;
    expect(at(0)).toBe('kid');
    expect([1, 2].map(at)).toEqual(['kid', 'kid']);
    expect([3, 6].map(at)).toEqual(['warrior', 'warrior']);
    expect([7, 13].map(at)).toEqual(['golden', 'golden']);
    expect([14, 29].map(at)).toEqual(['mane', 'mane']);
    expect([30, 49].map(at)).toEqual(['crimson', 'crimson']);
    expect([50, 400].map(at)).toEqual(['ape', 'ape']);
  });

  it('nextForm counts the days to the next threshold, and there is none after the last form', () => {
    expect(nextForm(1)).toMatchObject({ form: { id: 'warrior' }, in: 2 });
    expect(nextForm(6)).toMatchObject({ form: { id: 'golden' }, in: 1 });
    expect(nextForm(29)).toMatchObject({ form: { id: 'crimson' }, in: 1 });
    expect(nextForm(49)).toMatchObject({ form: { id: 'ape' }, in: 1 });
    expect(nextForm(50)).toBeNull();
  });

  it('the gallery keeps every form the longest streak reached, and always the kid', () => {
    expect(reachedForms(0)).toEqual(['kid']);
    expect(reachedForms(13)).toEqual(['kid', 'warrior', 'golden']);
    expect(reachedForms(50)).toEqual(FORMS.map(f => f.id));
  });

  it('isFormId accepts only the known ids', () => {
    for (const f of FORMS) expect(isFormId(f.id)).toBe(true);
    for (const bad of ['', 'Kid', 'goku', 'constructor', null, 3]) expect(isFormId(bad)).toBe(false);
  });
});

describe('the form follows the real streak', () => {
  it('a broken streak sends Rio back to the kid, while the gallery keeps the forms reached', () => {
    let s = emptyStreak();
    for (let d = 1; d <= 8; d++) s = addDay(s, `2026-03-${String(d).padStart(2, '0')}`);
    const on = (day: number) => streakStatus(s, new Date(2026, 2, day, 12));
    expect(formFor(on(8).current).id).toBe('golden');
    expect(warriorMood(on(9))).toBe('worried');
    // 03-09 missed: the starting bean keeps the streak, 03-10 is a second missed day and a bean from day 7 saves it too.
    expect(on(11)).toMatchObject({ state: 'at-risk', current: 8, beans: 0, gapSaved: 2 });
    expect(on(12)).toMatchObject({ state: 'none', current: 0 });
    expect(formFor(on(12).current).id).toBe('kid');
    expect(warriorMood(on(12))).toBe('defeated');
    expect(reachedForms(on(12).longest)).toEqual(['kid', 'warrior', 'golden']);
  });
});

describe('warriorMood and warriorMessage', () => {
  it('is defeated with no streak, worried while the streak needs today, ready otherwise', () => {
    expect(warriorMood(status({}))).toBe('defeated');
    expect(warriorMood(status({ state: 'at-risk', current: 4, longest: 4 }))).toBe('worried');
    expect(warriorMood(active(4))).toBe('ready');
  });

  it('tells a new learner and a learner with a broken streak apart', () => {
    expect(warriorMessage(status({}))).toMatch(/^No streak yet/);
    expect(warriorMessage(status({ longest: 3 }))).toMatch(/^Your streak ended/);
  });

  it('says whether a bean will save a missed day, or is saving one now', () => {
    expect(warriorMessage(status({ state: 'at-risk', current: 5, beans: 1 }))).toBe('Your 5-day streak needs a submission today. If you miss it, a spirit bean will save it.');
    expect(warriorMessage(status({ state: 'at-risk', current: 5, beans: 0 }))).toBe("Your 5-day streak needs a submission today. No spirit beans left, so don't miss it!");
    expect(warriorMessage(status({ state: 'at-risk', current: 5, beans: 0, gapSaved: 1 }))).toBe('A spirit bean saved your 5-day streak. Submit something today to keep it going.');
  });

  it('cheers in the voice of the current form, with the right plural', () => {
    expect(warriorMessage(active(1))).toBe('Rio has started training. Come back tomorrow to keep the streak going.');
    expect(warriorMessage(active(2))).toBe('2 days in a row. Rio is getting stronger.');
    expect(warriorMessage(active(7))).toContain('blazes gold');
    expect(warriorMessage(active(50))).toContain('Great Ape');
  });
});

describe('transformationFrom', () => {
  const ids = FORMS.map(f => f.id);

  it('plays from the last form shown to a higher one, and from the kid when nothing was shown yet', () => {
    expect(transformationFrom('kid', 'warrior')).toBe('kid');
    expect(transformationFrom('warrior', 'ape')).toBe('warrior');
    expect(transformationFrom(null, 'golden')).toBe('kid');
  });

  it('does not play for the same form, a lower one, or the kid', () => {
    for (const id of ids) expect(transformationFrom(id, id)).toBeNull();
    expect(transformationFrom('mane', 'kid')).toBeNull();
    expect(transformationFrom('crimson', 'golden')).toBeNull();
    expect(transformationFrom(null, 'kid')).toBeNull();
  });

  it('ranks follow the table', () => {
    expect(ids.map(formRank)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
