import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { TestsSpec } from '../content-model/types';
import { binaryName, buildProjectZip, defaultMakefile, projectZipEntries, type ProjectZipInput } from './project-zip';
import { parseLearnerFile } from './token';

const spec: TestsSpec = { version: 1, sources: ['caesar.c'], tests: [{ name: 't', run: { stdin: '' }, expect: { stdout: '' } }] };
const input: ProjectZipInput = {
  id: 'caesar', title: 'Caesar cipher', spec,
  files: { 'caesar.c': 'int main(void) { return 0; }\n', 'tests/test_rotate.c': '/* t */\n' },
  checkMjs: '#!/usr/bin/env node\n', learncH: '/* learnc */\n',
  learner: { version: 1, seed: '0123456789abcdef', exercise: 'caesar' },
};

describe('project zip', () => {
  it('lays out every file under one folder', () => {
    const files = unzipSync(buildProjectZip(input));
    expect(Object.keys(files).sort()).toEqual([
      'caesar/.learner', 'caesar/Makefile', 'caesar/README.md', 'caesar/caesar.c', 'caesar/check.json', 'caesar/check.mjs', 'caesar/learnc.h',
      'caesar/tests/test_rotate.c',
    ]);
    expect(JSON.parse(strFromU8(files['caesar/check.json']))).toEqual(spec);
    expect(parseLearnerFile(strFromU8(files['caesar/.learner'])).seed).toBe('0123456789abcdef');
  });
  it('is byte-for-byte deterministic', () => {
    expect(buildProjectZip(input)).toEqual(buildProjectZip(input));
  });
  it('keeps a project Makefile/README/learnc.h when provided and omits .learner without a seed', () => {
    const e = projectZipEntries({ ...input, learner: undefined, files: { ...input.files, Makefile: 'all:\n', 'README.md': '# Mine\n', 'learnc.h': 'own' } });
    expect(e.Makefile).toBe('all:\n');
    expect(e['README.md']).toBe('# Mine\n');
    expect(e['learnc.h']).toBe('own');
    expect(e['.learner']).toBeUndefined();
  });
  it('refuses paths that escape the folder', () => {
    expect(() => projectZipEntries({ ...input, files: { '../evil.c': 'x' } })).toThrow(/unsafe path/);
  });
  it('generates a Make 3.81-safe Makefile with tab-indented recipes', () => {
    const mk = defaultMakefile(spec, 'Caesar');
    expect(mk).toContain('BIN = caesar\n');
    expect(mk).toContain('test:\n\tnode check.mjs --cc "$(CC)"\n');
    expect(mk).not.toMatch(/!=|::=|\.ONESHELL|\$\(file /);
    expect(binaryName({ ...spec, binary: 'cipher' } as TestsSpec)).toBe('cipher');
  });
});
