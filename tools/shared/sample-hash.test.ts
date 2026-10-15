import { describe, expect, it } from 'vitest';
import { sampleHash } from './sample-hash';
import { sampleHashIso, sampleHashPayload } from './sample-hash-iso';

describe('sample hash', () => {
  const input = { code: '#include <stdio.h>\nint main(void) { puts("hi"); }\n', stdin: '3 4\n', args: ['-n', 'two words'], guardrail: true };

  it('node:crypto and SubtleCrypto versions agree', async () => {
    expect(await sampleHashIso(input)).toBe(sampleHash(input));
    expect(await sampleHashIso({ code: 'x' })).toBe(sampleHash({ code: 'x' }));
  });

  it('missing stdin/args/guardrail hash like their empty values', () => {
    expect(sampleHash({ code: 'x' })).toBe(sampleHash({ code: 'x', stdin: '', args: [], guardrail: false }));
    expect(sampleHashPayload({ code: 'x' })).toBe('["x","",[],false]');
  });

  it('changes when any input changes', () => {
    const base = sampleHash(input);
    expect(sampleHash({ ...input, code: input.code + ' ' })).not.toBe(base);
    expect(sampleHash({ ...input, stdin: '3 5\n' })).not.toBe(base);
    expect(sampleHash({ ...input, args: ['-n'] })).not.toBe(base);
    expect(sampleHash({ ...input, guardrail: false })).not.toBe(base);
  });

  it('is pinned (the app and the generated files must agree forever)', () => {
    expect(sampleHash({ code: 'int main(void) { return 0; }\n' })).toMatch(/^[0-9a-f]{16}$/);
    expect(sampleHash({ code: 'x' })).toBe('cb2b936943f166d9'); // = sha256('["x","",[],false]')[0:16]
  });
});
