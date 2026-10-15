// A YAML file read with source positions, so rules can point at the line of the field they complain about.
import { readFileSync } from 'node:fs';
import { LineCounter, isMap, isNode, isSeq, parseDocument, type Document } from 'yaml';
import type { FileReporter } from './messages';

export type YamlPath = Array<string | number>;

export class YamlFile {
  readonly doc: Document.Parsed;
  private readonly lines = new LineCounter();

  constructor(readonly file: string, readonly text: string) {
    this.doc = parseDocument(text.replace(/\r\n/g, '\n'), { lineCounter: this.lines, prettyErrors: false });
  }

  static read(file: string): YamlFile {
    return new YamlFile(file, readFileSync(file, 'utf8'));
  }

  /** Reports YAML syntax errors; returns true when the file parsed cleanly. */
  reportSyntax(r: FileReporter): boolean {
    for (const e of this.doc.errors) r.error(e.linePos?.[0].line ?? 1, 'yaml-syntax', `YAML error: ${e.message.split('\n')[0]}`);
    return this.doc.errors.length === 0;
  }

  /** The parsed value (null for an empty file). */
  get value(): unknown {
    return this.doc.toJS({ maxAliasCount: 100 }) ?? null;
  }

  /**
   * 1-based line of the node at `path`. For a mapping key the line of the key itself; for a sequence
   * item the line of the item. Falls back to the nearest ancestor that exists, then to line 1.
   */
  lineOf(path: YamlPath = []): number {
    for (let n = path.length; n >= 0; n--) {
      const sub = path.slice(0, n);
      const line = this.exactLine(sub);
      if (line > 0) return line;
    }
    return 1;
  }

  private exactLine(path: YamlPath): number {
    const offsetLine = (range: unknown): number => {
      const r = range as [number, number, number] | null | undefined;
      return r ? this.lines.linePos(r[0]).line : 0;
    };
    if (path.length === 0) return offsetLine(this.doc.contents?.range);
    const parent = this.doc.getIn(path.slice(0, -1), true);
    const last = path[path.length - 1];
    if (isMap(parent) && typeof last === 'string') {
      const pair = parent.items.find(p => isNode(p.key) && String((p.key as { value?: unknown }).value) === last);
      return pair && isNode(pair.key) ? offsetLine(pair.key.range) : 0;
    }
    if (isSeq(parent) && typeof last === 'number') {
      const item = parent.items[last];
      return isNode(item) ? offsetLine(item.range) : 0;
    }
    const node = this.doc.getIn(path, true);
    return isNode(node) ? offsetLine(node.range) : 0;
  }
}
