// Fenced-code meta parsing + MDX extraction (zero-dependency prototype).
// In the real site build, swap extractBlocks() for a remark/mdast visitor over `code`
// nodes (node.lang, node.meta) so MDX edge cases (JSX, nested fences) are handled by
// the same parser that renders the page. parseMeta() stays the same.

/**
 * Meta grammar (space separated, order-free):
 *   bare flags:      run predict trace
 *   key=value:       id=sizeof-basics  expect=compile-error  timeout=2000
 *   quoted values:   stdin="3 4\n"  args="-n 5 'two words'"   (JSON string escapes)
 *   lists:           sanitize=address,undefined   compilers=gcc,clang
 */
export function parseMeta(meta = "") {
  const out = {};
  const re = /([A-Za-z_][\w-]*)(?:=("(?:[^"\\]|\\.)*"|'[^']*'|[^\s]+))?/g;
  let m;
  while ((m = re.exec(meta))) {
    const [, key, raw] = m;
    if (raw === undefined) { out[key] = true; continue; }
    let v = raw;
    if (v.startsWith('"')) v = JSON.parse(v);            // supports \n \t \" é
    else if (v.startsWith("'")) v = v.slice(1, -1);       // literal, no escapes
    out[key] = v;
  }
  return out;
}

/** Normalised sample config with defaults. */
export function sampleConfig(meta) {
  const list = (v, d) => (v === undefined ? d : String(v).split(",").filter(Boolean));
  const expect = meta.expect ?? "success"; // success|warning|compile-error|runtime-error|exit:N|ub
  return {
    id: meta.id,
    run: meta.run === true || meta.predict === true || meta.trace === true,
    predict: meta.predict === true,
    trace: meta.trace === true,
    stdin: meta.stdin ?? "",
    args: meta.args ? splitArgs(meta.args) : [],
    expect,
    warn: list(meta.warn, []),                       // e.g. warn=-Wformat (required flags)
    sanitize: list(meta.sanitize, []),               // address,undefined,leak
    compilers: list(meta.compilers, ["gcc", "clang"]),
    timeoutMs: Number(meta.timeout ?? 3000),
    norm: meta.norm ?? "ptr",                        // ptr | all-hex | none
    platform: meta.platform === true,                // output legitimately differs per ABI
    std: meta.std ?? "c17",
    files: meta.files ? String(meta.files).split(",") : [],
    lm: meta.lm === true,                            // link -lm
  };
}

function splitArgs(s) {
  const out = [];
  const re = /'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? (m[2] !== undefined ? JSON.parse(`"${m[2]}"`) : m[3]));
  return out;
}

/** Extract ```c fences (and ~~~c) with their meta and 1-based source line. */
export function extractBlocks(text, file = "<mdx>") {
  const lines = text.split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*([\w+-]+)?\s*(.*)$/.exec(lines[i]);
    if (!open) continue;
    const [, indent, fence, lang = "", meta] = open;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = new RegExp(`^\\s*${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
      if (close.test(lines[j])) break;
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    if (lang === "c" || lang === "h") {
      blocks.push({ file, line: i + 1, lang, metaRaw: meta.trim(), meta: parseMeta(meta), code: body.join("\n") + "\n" });
    }
    i = j;
  }
  return blocks;
}
