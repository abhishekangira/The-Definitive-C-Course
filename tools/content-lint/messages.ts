// Lint messages and the collector every rule reports into.

export type Severity = 'error' | 'warning' | 'info';

export interface LintMessage {
  severity: Severity;
  /** Short rule id, printed in brackets and listed in README.md (e.g. "word-budget"). */
  rule: string;
  /** Absolute path. The CLI prints it relative to the working directory. */
  file: string;
  /** 1-based; 0 when the problem belongs to the whole file. */
  line: number;
  message: string;
  /** Module id ("m01") the file belongs to; undefined for site-level files (videos.json, course.yaml). */
  module?: string;
}

/** A reporter bound to one file (and module), so rules only pass a line, a rule id and the text. */
export interface FileReporter {
  readonly file: string;
  error(line: number, rule: string, message: string): void;
  warn(line: number, rule: string, message: string): void;
  /** A note. It never fails a run, not even with `--strict`. */
  info(line: number, rule: string, message: string): void;
  /**
   * Something a module must have before it is released: a quiz file, its project, an exercise it lists. It is reported
   * with `severity` for a released module and as a note for a draft (an unreleased module), which is still being built.
   */
  gap(line: number, rule: string, message: string, severity?: 'error' | 'warning'): void;
}

export class Collector {
  readonly messages: LintMessage[] = [];
  /** Ids of the modules course.yaml does not release (`available: false`). */
  readonly drafts = new Set<string>();

  add(m: LintMessage): void {
    this.messages.push(m);
  }

  at(file: string, module?: string): FileReporter {
    const report = (severity: Severity) => (line: number, rule: string, message: string) => this.add({ severity, rule, file, line, message, module });
    return {
      file,
      error: report('error'),
      warn: report('warning'),
      info: report('info'),
      gap: (line, rule, message, severity = 'error') => report(module !== undefined && this.drafts.has(module) ? 'info' : severity)(line, rule, message),
    };
  }

  private count(severity: Severity): number {
    return this.messages.filter(m => m.severity === severity).length;
  }

  get errorCount(): number {
    return this.count('error');
  }

  get warningCount(): number {
    return this.count('warning');
  }
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Stable order for printing: file, then line, then errors before warnings before notes. */
export function sortMessages(messages: readonly LintMessage[]): LintMessage[] {
  return [...messages].sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || RANK[a.severity] - RANK[b.severity] || a.rule.localeCompare(b.rule));
}
