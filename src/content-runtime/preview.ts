// The unreleased modules this page load previews (`?preview=m03`, see release.ts). It is read once from the page URL, before
// the `#`: HashRouter's own query lives after the `#` and the first link would drop it, while this one survives every
// in-app link and a reload. The progress store imports this file too, so it must not import course.ts.
import type { CourseManifest } from '../content-model/types';
import courseYaml from '../../content/course.yaml';
import { dirOf, previewedModules } from './release';

const dirsOnDisk = new Set(Object.keys(import.meta.glob('/content/modules/*/module.yaml')).map(dirOf));

export const previewed: readonly string[] = previewedModules(
  typeof location === 'undefined' ? '' : location.search,
  (courseYaml as CourseManifest).modules,
  dirsOnDisk,
);
