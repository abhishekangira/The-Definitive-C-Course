import { expect, it } from 'vitest';

it('PROBE #117: a failing unit test must fail the image workflow', () => {
  expect(1).toBe(2);
});
