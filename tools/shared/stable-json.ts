// Deterministic JSON for generated files: object keys sorted (recursively), undefined dropped,
// 2-space indent, trailing newline. Arrays keep their order. Generated files are committed and
// `--check` compares them byte for byte, so the same data must always serialise the same way.

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(v => (v === undefined ? null : sortKeysDeep(v)));
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeysDeep(v);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeysDeep(value), null, indent) + '\n';
}
