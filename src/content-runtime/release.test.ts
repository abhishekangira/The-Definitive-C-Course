import { describe, expect, it } from 'vitest';
import type { LessonFrontmatter } from '../content-model/types';
import { buildRegistry, indexExercises, previewedModules } from './release';

// A fake course: m01 and m02 are released; m03 and m04 are planned. m03 has a folder (a draft being built), m04 has none.
const manifest = [
  { id: 'm01', dir: 'm01-one', available: true },
  { id: 'm02', dir: 'm02-two', available: true },
  { id: 'm03', dir: 'm03-three', available: false },
  { id: 'm04', dir: 'm04-four', available: false },
];
const onDisk = new Set(['m01-one', 'm02-two', 'm03-three']);

describe('previewedModules', () => {
  it('opens an unreleased module that has a folder', () => {
    expect(previewedModules('?preview=m03', manifest, onDisk)).toEqual(['m03']);
  });

  it('takes a comma list among other query keys, in course order', () => {
    const all = new Set([...onDisk, 'm04-four']);
    expect(previewedModules('?x=1&preview=m04,m03', manifest, all)).toEqual(['m03', 'm04']);
  });

  it('ignores a released module, an unknown id and an unreleased module with no folder', () => {
    expect(previewedModules('?preview=m01,m02,m99,m04', manifest, onDisk)).toEqual([]);
  });

  it('opens nothing without the parameter, or with an empty one', () => {
    expect(previewedModules('', manifest, onDisk)).toEqual([]);
    expect(previewedModules('?preview=', manifest, onDisk)).toEqual([]);
    expect(previewedModules('?previews=m03', manifest, onDisk)).toEqual([]);
  });
});

describe('buildRegistry', () => {
  const metas = {
    '/content/modules/m01-one/module.yaml': { id: 'm01', lessons: ['a'] },
    '/content/modules/m02-two/module.yaml': { id: 'm02', lessons: ['a'] },
    '/content/modules/m03-three/module.yaml': { id: 'm03', lessons: ['a', 'b'] },
  };
  const fm = (id: string) => ({ id, title: id, minutes: 30, summary: '' }) satisfies LessonFrontmatter;
  const frontmatter = {
    '/content/modules/m01-one/lessons/a.mdx': fm('m01-a'),
    '/content/modules/m02-two/lessons/a.mdx': fm('m02-a'),
    '/content/modules/m03-three/lessons/a.mdx': fm('m03-a'),
    // m03's lesson "b" is listed in its module.yaml but has no file yet.
  };

  it('registers the released modules and leaves out a module that is on disk but not released', () => {
    expect(Object.keys(buildRegistry(manifest, metas, frontmatter))).toEqual(['m01', 'm02']);
  });

  it('does not read a draft’s lessons, so a half-built module cannot make the app throw', () => {
    expect(() => buildRegistry(manifest, metas, frontmatter)).not.toThrow();
  });

  it('opens a draft only when it is previewed, and then a missing lesson file is reported', () => {
    expect(() => buildRegistry(manifest, metas, frontmatter, ['m03'])).toThrow('module m03: lesson "b" not found');
    const ready = { ...frontmatter, '/content/modules/m03-three/lessons/b.mdx': fm('m03-b') };
    const registry = buildRegistry(manifest, metas, ready, ['m03']);
    expect(Object.keys(registry)).toEqual(['m01', 'm02', 'm03']);
    expect(registry.m03.lessons.map(l => l.stem)).toEqual(['a', 'b']);
  });

  it('still reports a missing lesson of a released module', () => {
    const { '/content/modules/m02-two/lessons/a.mdx': _gone, ...fewer } = frontmatter;
    expect(() => buildRegistry(manifest, metas, fewer)).toThrow('module m02: lesson "a" not found');
  });

  it('leaves out a module that course.yaml does not list', () => {
    const extra = { ...metas, '/content/modules/m09-nine/module.yaml': { id: 'm09', lessons: [] } };
    expect(Object.keys(buildRegistry(manifest, extra, frontmatter))).toEqual(['m01', 'm02']);
  });
});

describe('indexExercises', () => {
  const registry = {
    m01: { dir: 'm01-one', meta: { id: 'm01', lessons: [] }, lessons: [] },
    m02: { dir: 'm02-two', meta: { id: 'm02', lessons: [] }, lessons: [] },
  };

  it('keys exercises, variants and projects by their folder without the module', () => {
    const out = indexExercises({
      '/content/modules/m01-one/exercises/cash/exercise.yaml': 'cash',
      '/content/modules/m01-one/exercises/cash/variants/2/exercise.yaml': 'cash-2',
      '/content/modules/m02-two/project/credit/exercise.yaml': 'credit',
    }, registry);
    expect(Object.keys(out)).toEqual(['cash', 'cash/variants/2', 'project/credit']);
    expect(out['cash/variants/2']).toEqual({ id: 'cash/variants/2', moduleId: 'm01', folder: 'exercises/cash/variants/2', meta: 'cash-2' });
    expect(out['project/credit'].moduleId).toBe('m02');
  });

  it('leaves out the exercises of a module that is not registered, so a draft cannot replace a released exercise', () => {
    const out = indexExercises({
      '/content/modules/m01-one/exercises/cash/exercise.yaml': 'released',
      '/content/modules/m03-three/exercises/cash/exercise.yaml': 'draft',
      '/content/modules/m03-three/exercises/only-in-draft/exercise.yaml': 'draft',
    }, registry);
    expect(out.cash).toMatchObject({ moduleId: 'm01', meta: 'released' });
    expect(Object.keys(out)).toEqual(['cash']);
  });
});
