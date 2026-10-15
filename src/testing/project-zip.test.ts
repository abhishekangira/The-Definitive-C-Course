import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { TestsSpec } from '../content-model/types';
import { binaryName, buildProjectZip, buildZipFromFolder, defaultMakefile, folderToProjectFiles, projectZipEntries, zipFolderName, type ProjectZipInput } from './project-zip';
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

describe('from a content folder (what the app loads)', () => {
  const tests = JSON.stringify(spec);
  const exercise = { 'starter.c': 'int main(void) { return 1; }\n', 'solution.c': 'int main(void) { return 0; }\n', 'tests.json': tests, 'tests/test_rotate.c': '/* t */\n', 'variants/1/starter.c': 'x', 'README.md': '# Hi\n' };
  const project = { 'starter/mario.c': 'S', 'solution/mario.c': 'SOL', 'check.json': tests, 'Makefile': 'all:\n', 'tests/t.c': 'T', 'exercise.yaml': 'id: x', 'project.mdx': '# page' };

  it('exercise layout: starter.c becomes the learner file; solutions and authoring files stay behind', () => {
    expect(folderToProjectFiles(exercise, { learnerFile: 'caesar.c' })).toEqual({
      'README.md': '# Hi\n', 'tests/test_rotate.c': '/* t */\n', 'caesar.c': 'int main(void) { return 1; }\n',
    });
    expect(folderToProjectFiles(exercise, { learnerFile: 'caesar.c', code: 'solution' })['caesar.c']).toBe('int main(void) { return 0; }\n');
  });
  it('project layout: starter/ is flattened into the root and solution/ never ships', () => {
    expect(folderToProjectFiles(project, { learnerFile: 'mario.c' })).toEqual({ Makefile: 'all:\n', 'tests/t.c': 'T', 'mario.c': 'S' });
    expect(() => folderToProjectFiles({ 'tests.json': tests }, { learnerFile: 'a.c' })).toThrow(/neither a starter\/ directory nor a starter\.c/);
  });
  it('names the zip folder after the exercise id', () => {
    expect([zipFolderName('project/mario-more'), zipFolderName('cash/variants/1'), zipFolderName('Hello-World')]).toEqual(['mario-more', 'cash-v1', 'hello-world']);
  });
  it('builds the whole download, with the app-style id recorded in .learner', () => {
    const zip = buildZipFromFolder({ exerciseId: 'project/caesar', title: 'Caesar', folder: exercise, seed: '0123456789abcdef', checkMjs: '#!/usr/bin/env node\n', learncH: '/* l */\n' });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      'caesar/.learner', 'caesar/Makefile', 'caesar/README.md', 'caesar/caesar.c', 'caesar/check.json', 'caesar/check.mjs', 'caesar/learnc.h', 'caesar/tests/test_rotate.c',
    ]);
    expect(parseLearnerFile(strFromU8(files['caesar/.learner'])).exercise).toBe('project.caesar');
    expect(strFromU8(files['caesar/caesar.c'])).toContain('return 1');
    expect(() => buildZipFromFolder({ exerciseId: 'x', folder: {}, seed: '0123456789abcdef', checkMjs: '', learncH: '' })).toThrow(/no tests\.json or check\.json/);
    expect(() => buildZipFromFolder({ exerciseId: 'x', folder: { 'tests.json': '{' }, seed: '0123456789abcdef', checkMjs: '', learncH: '' })).toThrow(/not valid JSON/);
  });
});
