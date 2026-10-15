// Lint messages and the collector every rule reports into.

export type Severity = 'error' | 'warning';

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
}

export class Collector {
  readonly messages: LintMessage[] = [];

  add(m: LintMessage): void {
    this.messages.push(m);
  }

  at(file: string, module?: string): FileReporter {
    return {
      file,
      error: (line, rule, message) => this.add({ severity: 'error', rule, file, line, message, module }),
      warn: (line, rule, message) => this.add({ severity: 'warning', rule, file, line, message, module }),
    };
  }

  get errorCount(): number {
    return this.messages.filter(m => m.severity === 'error').length;
  }

  get warningCount(): number {
    return this.messages.length - this.errorCount;
  }
}

/** Stable order for printing: file, then line, then errors before warnings. */
export function sortMessages(messages: readonly LintMessage[]): LintMessage[] {
  return [...messages].sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || a.rule.localeCompare(b.rule));
}
