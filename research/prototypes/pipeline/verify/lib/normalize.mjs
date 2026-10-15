// Output normaliser: makes native / wasm / macOS / Linux outputs comparable while
// preserving pointer *equality* (same address -> same token, in first-seen order).

const NULL_FORMS = /\(nil\)|\b0x0+\b/g; // glibc prints NULL %p as "(nil)", macOS/musl as "0x0"

/**
 * @param {string} text
 * @param {{mode?: 'ptr'|'all-hex'|'none', minHexDigits?: number, map?: Map<string,string>,
 *          paths?: string[]}} opts
 *  mode 'ptr' (default): only hex numbers with >= minHexDigits digits (default 5) are treated
 *    as addresses, so printf("%#x", 255) -> "0xff" survives untouched. wasm32 addresses are
 *    small (e.g. 0x110a0, 5 digits) so 5 is the safe floor; use 'all-hex' if a lesson prints
 *    tiny pointers, 'none' when the hex itself is the lesson.
 *  Pass a shared `map` to normalise stdout+stderr of one run consistently.
 */
export function normalize(text, opts = {}) {
  const { mode = "ptr", minHexDigits = 5, map = new Map(), paths = [] } = opts;
  let s = text.replace(/\r\n/g, "\n");
  for (const p of paths) s = s.split(p).join("<tmp>");          // temp build dirs
  s = s.replace(/^==\d+==/gm, "==PID==");                        // ASan/valgrind pid prefix
  s = s.replace(/\bpid=\d+\b/g, "pid=<pid>");
  s = s.replace(/\bthread T\d+\b/g, "thread T<n>");
  if (mode === "none") return s;
  s = s.replace(NULL_FORMS, "<NULL>");
  const re = mode === "all-hex" ? /\b0x[0-9a-fA-F]+\b/g : new RegExp(`\\b0x[0-9a-fA-F]{${minHexDigits},}\\b`, "g");
  s = s.replace(re, (hex) => {
    const key = hex.toLowerCase().replace(/^0x0+(?=.)/, "0x");   // 0x00007ffc.. == 0x7ffc..
    if (!map.has(key)) map.set(key, `<addr${map.size + 1}>`);
    return map.get(key);
  });
  return s;
}

/** Line-level diff for reports (tiny LCS; samples are short). */
export function lineDiff(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push("  " + A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push("- " + A[i++]);
    else out.push("+ " + B[j++]);
  }
  while (i < A.length) out.push("- " + A[i++]);
  while (j < B.length) out.push("+ " + B[j++]);
  return out.join("\n");
}

/** Parse gcc/clang text diagnostics into structured records. */
export function parseDiagnostics(stderr) {
  const out = [];
  const re = /^(.*?):(\d+):(\d+): (warning|error|note|fatal error): (.*?)(?: \[([^\]]+)\])?$/gm;
  let m;
  while ((m = re.exec(stderr))) {
    // gcc: [-Wformat=] / [-Werror=unused-variable]; clang: [-Wformat] / [-Werror,-Wunused-variable]
    const flags = (m[6] ?? "").split(",").map((f) => f.trim().replace(/^-Werror=/, "-W").replace(/=.*$/, ""))
      .filter((f) => f.startsWith("-W") && f !== "-Werror");
    out.push({ file: m[1], line: +m[2], col: +m[3], severity: m[4].replace("fatal ", ""), message: m[5], flag: flags[0] ?? null });
  }
  return out;
}

/** Condense an ASan/UBSan/LSan report to what a learner needs (kind, access, user frames). */
export function summarizeSanitizer(stderr, srcName) {
  const kind = /ERROR: (AddressSanitizer|LeakSanitizer): ([\w-]+)/.exec(stderr)
    ?? /(runtime error): (.*)/.exec(stderr);
  if (!kind) return null;
  const userFrames = stderr.split("\n").filter((l) => l.includes(srcName) && /#\d+|runtime error/.test(l))
    .map((l) => l.replace(/^\s*#\d+ <addr\d+> in /, "").trim());
  const access = /^(READ|WRITE) of size \d+/m.exec(stderr)?.[0] ?? null;
  const where = /is located .*$/m.exec(stderr)?.[0] ?? null;
  const summary = /^SUMMARY: .*$/m.exec(stderr)?.[0] ?? null;
  return { tool: kind[1], kind: kind[2], access, where, frames: [...new Set(userFrames)], summary };
}

/**
 * Display-oriented alternative to token normalisation: replace real addresses with
 * deterministic fake ones that PRESERVE OFFSETS inside a region (so "&b is 4 bytes after
 * &a" and "malloc blocks are 32 bytes apart" survive) while removing ASLR randomness.
 * Addresses within 1 MiB of each other form a group; each group is rebased to a fixed
 * fake base chosen by the group's magnitude (stack-like / heap-like / image-like).
 */
export function rebaseAddresses(text, { minHexDigits = 5 } = {}) {
  const re = new RegExp(`\\b0x[0-9a-fA-F]{${minHexDigits},}\\b`, "g");
  const addrs = [...new Set((text.match(re) ?? []).map((h) => BigInt(h)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const groups = [];
  for (const a of addrs) {
    const g = groups.at(-1);
    if (g && a - g.max < 0x100000n) g.max = a; else groups.push({ min: a, max: a });
  }
  // stack (>= 0x7f..): Linux randomises the stack's page offset too, so keep only 16-byte
  // alignment; heap/image groups keep their (stable) in-page offset.
  let lowIdx = 0n, stackIdx = 0n;
  for (const g of groups) {
    if (g.min >= 0x7f0000000000n) g.base = 0x7ffd4a3c1bc0n + stackIdx++ * 0x10000000n + (g.min & 0xfn);
    else g.base = 0x55d0c1400000n + lowIdx++ * 0x01000000n + (g.min & 0xfffn); // image, then heap
  }
  return text.replace(re, (h) => {
    const a = BigInt(h);
    const g = groups.find((g) => a >= g.min && a <= g.max);
    return "0x" + (g.base + (a - g.min)).toString(16);
  });
}
