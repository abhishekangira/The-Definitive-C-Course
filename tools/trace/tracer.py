# tracer.py - build-time C execution tracer for the stepper / memory visualizer (PLAN §3.3).
# Ported from research/prototypes/pipeline/trace/tracer.py; writes the TraceFile shape of
# src/content-model/types.ts directly.
#
#   TRACE_PROG=./prog TRACE_SRC=main.c TRACE_OUT=out.json TRACE_SAMPLE=<id> \
#   [TRACE_STDIN=in.txt] [TRACE_ARGS='["a","b"]'] [TRACE_MAX_STEPS=1000] [TRACE_VALGRIND=1] \
#   gdb -q -nx -batch -x tracer.py
#
# The program must be built with -g -O0 -fno-omit-frame-pointer -fno-inline plus heap_shim.o and
# -Wl,--wrap=malloc,--wrap=free,--wrap=calloc,--wrap=realloc (see trace.ts).
#
# Addresses are rebased per region so traces are stable and leak no real addresses; offsets
# inside a region are real (x86-64 Linux, gcc, glibc):
#   stack  0x7ffc00002000 - (main's CFA - addr)
#   heap   0x55500000 + (addr - heap start)      (first glibc chunk lands at +0x2a0)
#   image  0x400000 + (addr - load base)
#   other  "0x?NNNN" (libc, vdso, garbage: low 16 bits only)
import gdb
import json
import math
import os
import re
import shlex
import struct

PROG = os.environ["TRACE_PROG"]
SRC_PATH = os.environ["TRACE_SRC"]
SRC = os.path.basename(SRC_PATH)
OUT = os.environ["TRACE_OUT"]
SAMPLE = os.environ.get("TRACE_SAMPLE", SRC)
STDIN = os.environ.get("TRACE_STDIN", "/dev/null")
ARGS = json.loads(os.environ.get("TRACE_ARGS", "[]"))
MAX_STEPS = int(os.environ.get("TRACE_MAX_STEPS", "1000"))
MAX_ELEMS = 64
STDOUT_FILE = OUT + ".stdout"
STDERR_FILE = OUT + ".stderr"
VALGRIND = os.environ.get("TRACE_VALGRIND") == "1"
VG_PREFIX = OUT + ".vgdb"

FAKE_STACK_TOP = 0x7FFC00002000
FAKE_HEAP = 0x55500000
FAKE_IMAGE = 0x400000


def ex(cmd):
    return gdb.execute(cmd, to_string=True)


for c in ("set pagination off", "set confirm off", "set width 0", "set debuginfod enabled off",
          # no libc6-dbg symbols: keeps `step` out of printf & co.
          "set debug-file-directory /nonexistent",
          "set disable-randomization on", "set startup-with-shell on"):
    ex(c)
ex("file " + PROG)

state = {"exit_code": None, "signal": None, "vg_errors": []}


def on_exit(ev):
    state["exit_code"] = getattr(ev, "exit_code", None)


def on_stop(ev):
    if isinstance(ev, gdb.SignalEvent):
        if VALGRIND and ev.stop_signal == "SIGTRAP":
            state["vg_errors"].append(ex("monitor v.info last_error").strip())
        else:
            state["signal"] = ev.stop_signal


gdb.events.exited.connect(on_exit)
gdb.events.stop.connect(on_stop)


def is_user(frame):
    try:
        sal = frame.find_sal()
        return (frame.function() is not None and sal.symtab is not None
                and os.path.basename(sal.symtab.filename) == SRC)
    except gdb.error:
        return False


def user_frames():  # newest first
    out, f = [], gdb.newest_frame()
    while f is not None:
        if is_user(f):
            out.append(f)
        f = f.older()
    return out


def frame_cfa(frame):
    frame.select()
    m = re.search(r"frame at (0x[0-9a-f]+)", ex("info frame"))
    return int(m.group(1), 16)


# ---------- memory regions & address rebasing ----------
anchors = {}


def read_maps():
    pid = anchors.get("vg_pid") or gdb.selected_inferior().pid
    regs = []
    with open("/proc/%d/maps" % pid) as fh:
        for line in fh:
            parts = line.split()
            lo, hi = (int(x, 16) for x in parts[0].split("-"))
            regs.append((lo, hi, parts[5] if len(parts) > 5 else ""))
    return regs


def refresh_anchors():
    regs = read_maps()
    prog_real = os.path.realpath(PROG)
    for lo, hi, name in regs:
        if name == "[heap]" and "heap" not in anchors:
            anchors["heap"] = (lo, hi)
        if name == prog_real and "image" not in anchors:
            anchors["image"] = lo
    anchors["image_hi"] = max(hi for lo, hi, n in regs if n == prog_real)


def region_of(addr):
    if addr == 0:
        return "null"
    if anchors["main_cfa"] - (1 << 20) <= addr < anchors["main_cfa"] + 0x1000:
        return "stack"
    if "heap" not in anchors:
        hb = heap_blocks()
        if hb:  # glibc: the first chunk sits at [heap]+0x2a0
            anchors["heap"] = (hb[0]["ptr"] - 0x2a0, hb[0]["ptr"] + (64 << 20))
    h = anchors.get("heap")
    if h and h[0] <= addr < h[1]:
        return "heap"
    if anchors["image"] <= addr < anchors["image_hi"]:
        return "image"
    return "other"


def fake(addr):
    r = region_of(addr)
    if r == "null":
        return "0x0"
    if r == "stack":
        return hex(FAKE_STACK_TOP - (anchors["main_cfa"] - addr))
    if r == "heap":
        return hex(FAKE_HEAP + (addr - anchors["heap"][0]))
    if r == "image":
        return hex(FAKE_IMAGE + (addr - anchors["image"]))
    return "0x?" + format(addr & 0xFFFF, "04x")


# ---------- heap registry (heap_shim.c) ----------
def heap_blocks():
    inf = gdb.selected_inferior()
    n = int(gdb.parse_and_eval("*(int*)&__ht_count"))
    base = int(gdb.parse_and_eval("(long)&__ht_blocks"))
    raw = bytes(inf.read_memory(base, 24 * n)) if n else b""
    out = []
    for i in range(n):
        ptr, size, alive_, bid = struct.unpack_from("<QQii", raw, 24 * i)
        out.append({"id": bid, "ptr": ptr, "size": size, "alive": bool(alive_)})
    return out


# ---------- definedness via memcheck (valgrind mode only) ----------
def vbits(addr, size):
    """Per-byte mask: 'd' defined, 'u' undefined, 'p' partially defined."""
    if not VALGRIND or addr is None or size == 0:
        return None
    try:
        outp = ex("monitor get_vbits 0x%x %d" % (addr, size))
    except gdb.error:
        return None
    hexs = "".join(outp.split())
    if not re.fullmatch(r"[0-9a-f]+", hexs):
        return None
    bs = bytes.fromhex(hexs)[:size]
    return "".join("d" if b == 0 else ("u" if b == 0xFF else "p") for b in bs)


def significant(t, size):
    """Per-byte flags: False for struct padding, which is never initialised and must not make
    an otherwise fully set struct look uninitialised."""
    t = t.strip_typedefs()
    if t.code == gdb.TYPE_CODE_ARRAY and t.target().sizeof:
        n = size // t.target().sizeof
        return significant(t.target(), t.target().sizeof) * n + [True] * (size - n * t.target().sizeof)
    if t.code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
        mask = [False] * size
        for f in t.fields():
            if not hasattr(f, "bitpos") or f.type is None:
                continue
            off = f.bitpos // 8
            fs = f.type.sizeof if not f.bitsize else (f.bitpos % 8 + f.bitsize + 7) // 8
            sub = significant(f.type, fs) if not f.bitsize else [True] * fs
            for i, flag in enumerate(sub):
                if off + i < size and flag:
                    mask[off + i] = True
        return mask
    return [True] * size


def add_init(d, addr, size, t=None):
    m = vbits(addr, size)
    if m is not None:
        sig = significant(t, size) if t is not None else [True] * size
        d["init"] = all(c == "d" for c, s in zip(m, sig) if s)
        if not d["init"] and any(c == "d" for c in m):
            d["vbits"] = m


# ---------- values (TraceValue) ----------
INTLIKE = (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_CHAR, gdb.TYPE_CODE_BOOL, gdb.TYPE_CODE_ENUM)


def is_char_type(t):
    return t.code == gdb.TYPE_CODE_CHAR or (t.sizeof == 1 and t.name is not None and "char" in t.name)


def is_unsigned(t):
    try:
        return not t.is_signed
    except (AttributeError, ValueError):
        return t.name is not None and "unsigned" in t.name


def raw_hex(val):
    try:
        addr = val.address
        if addr is None:
            return ""
        return bytes(gdb.selected_inferior().read_memory(int(addr), min(val.type.sizeof, 256))).hex()
    except (gdb.error, gdb.MemoryError):
        return ""


def float_json(x):
    if math.isnan(x):
        return "nan"
    if math.isinf(x):
        return "inf" if x > 0 else "-inf"
    return x


class Snapshot:
    def __init__(self):
        self.pointers = []  # (rendered dict, raw addr, target gdb.Type)
        self.objects = []   # (lo, hi, ref dict) for stack/global vars and heap blocks

    def render(self, val):
        t = val.type.strip_typedefs()
        code = t.code
        try:
            if code == gdb.TYPE_CODE_BOOL:
                return {"t": "bool", "v": bool(int(val))}
            if code in INTLIKE:
                v = int(val)
                if is_char_type(t):
                    return {"t": "char", "v": v}
                return {"t": "uint" if is_unsigned(t) else "int", "v": v}
            if code == gdb.TYPE_CODE_FLT:
                return {"t": "float", "v": float_json(float(val))}
            if code == gdb.TYPE_CODE_PTR:
                addr = int(val)
                tgt = t.target()
                d = {"t": "ptr", "v": fake(addr), "ref": None}
                if tgt.strip_typedefs().code == gdb.TYPE_CODE_FUNC:
                    s = str(val)
                    if "<" in s:
                        d["fn"] = s.split("<")[-1].rstrip(">")
                    return d
                self.pointers.append((d, addr, tgt))
                return d
            if code == gdb.TYPE_CODE_ARRAY:
                lo, hi = t.range()
                n = hi - lo + 1
                elems = [self.render(val[i]) for i in range(lo, lo + min(n, MAX_ELEMS))]
                d = {"t": "array", "elems": elems}
                if n > MAX_ELEMS:
                    d["len"] = n
                et = t.target().strip_typedefs()
                if et.sizeof == 1 and et.code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_CHAR):
                    raw = bytes(int(val[i]) & 0xFF for i in range(lo, lo + n))
                    if b"\0" in raw:
                        d["str"] = raw.split(b"\0")[0].decode("latin-1")
                return d
            if code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
                fields = []
                for f in t.fields():
                    if not hasattr(f, "bitpos") or f.name is None:
                        continue
                    fields.append({"name": f.name, "type": str(f.type), "offset": f.bitpos // 8,
                                   "value": self.render(val[f])})
                return {"t": "struct", "fields": fields}
        except (gdb.MemoryError, gdb.error):
            pass
        return {"t": "raw", "hex": raw_hex(val)}

    def var(self, name, val, ref, **flags):
        addr = int(val.address) if val.address is not None else None
        size = val.type.sizeof
        if addr is not None:
            self.objects.append((addr, addr + size, ref))
        declared = flags.pop("declared", None)
        # A variable whose declaration has not run yet holds stack garbage: different on every run and never
        # shown to the learner. Record "declared": false and a fixed placeholder instead of the bytes.
        value = {"t": "raw", "hex": ""} if declared is False else self.render(val)
        d = {"name": name, "type": str(val.type), "addr": fake(addr) if addr else "",
             "size": size, "value": value}
        if declared is not None:
            d["declared"] = bool(declared)
        for k, v in flags.items():
            if v:
                d[k] = True
        add_init(d, addr, size, val.type)
        return d

    def resolve(self, addr):
        for lo, hi, ref in self.objects:
            if lo <= addr < hi:
                r = dict(ref)
                r["offset"] = addr - lo
                return r
        return None


def frame_vars(frame, snap, fidx, cur_line):
    out, seen = [], set()
    try:
        block = frame.block()
    except RuntimeError:
        return out
    blocks = []
    while block is not None:
        blocks.append(block)
        if block.function is not None:
            break
        block = block.superblock
    for b in reversed(blocks):  # outermost (parameters) first; inner scopes appear only inside them
        for sym in b:
            if not (sym.is_variable or sym.is_argument) or sym.name in seen:
                continue
            seen.add(sym.name)
            try:
                val = sym.value(frame)
            except Exception:
                continue
            static = sym.addr_class == gdb.SYMBOL_LOC_STATIC
            ref = {"kind": "global" if static else "local", "frame": fidx, "name": sym.name}
            # Without valgrind, "declared" is a guess: the declaration line has been passed.
            declared = sym.is_argument or static or sym.line < cur_line
            out.append(snap.var(sym.name, val, ref, param=sym.is_argument, static=static, declared=declared))
    return out


def globals_of(frame, snap):
    out = []
    blk = frame.block()
    for b in (blk.global_block, blk.static_block):
        for sym in b:
            if sym.is_variable and sym.symtab and os.path.basename(sym.symtab.filename) == SRC:
                out.append(snap.var(sym.name, sym.value(), {"kind": "global", "name": sym.name},
                                    static=(b is blk.static_block)))
    return out


def at_closing_brace(frame):
    blk = frame.block()
    while blk.function is None:
        blk = blk.superblock
    return frame.find_sal().line == gdb.find_pc_line(blk.end - 1).line


def return_value(frame):
    """x86-64 SysV: integers/pointers in rax, doubles in xmm0. Aggregates are not captured."""
    rt = frame.function().type.target().strip_typedefs()
    if rt.code == gdb.TYPE_CODE_VOID:
        return None
    frame.select()
    if rt.code in INTLIKE + (gdb.TYPE_CODE_PTR,):
        return Snapshot().render(gdb.parse_and_eval("$rax").cast(rt))
    if rt.code == gdb.TYPE_CODE_FLT:
        reg = "$xmm0.v2_double[0]" if rt.sizeof == 8 else "$xmm0.v4_float[0]"
        return Snapshot().render(gdb.parse_and_eval(reg).cast(rt))
    return None


VG_NOISE = ("(action on error)", "(action at startup)", "Continuing", "HEAP SUMMARY",
            "LEAK SUMMARY", "For lists of", "ERROR SUMMARY", "All heap blocks", "in use at exit",
            "total heap usage", "TO DEBUG", "Memcheck,", "Copyright", "Using Valgrind", "Command:",
            "Parent PID", "and then give", "--pid is optional", "/path/to/gdb", "target remote")


def new_vg_errors():
    """memcheck errors logged since the last call. gdb's `step` swallows the SIGTRAP vgdb sends
    on an error, so the log file is read instead."""
    if not VALGRIND:
        return []
    try:
        with open(OUT + ".vglog") as fh:
            fh.seek(anchors.get("vglog_pos", 0))
            text = fh.read()
            anchors["vglog_pos"] = fh.tell()
    except OSError:
        return []
    lines = [re.sub(r"^==\d+== ?", "", l) for l in text.split("\n")]
    paras, cur = [], []
    for l in lines + [""]:
        if l.strip():
            cur.append(l)
        elif cur:
            paras.append(cur)
            cur = []
    errs = []
    for p in paras:
        if any(p[0].lstrip().startswith(n) for n in VG_NOISE):
            continue
        keep = [p[0]] + [l.strip() for l in p[1:]
                         if SRC + ":" in l or not l.strip().startswith(("at ", "by "))]
        errs.append("\n".join(keep))
    return errs


def read_text(path):
    try:
        with open(path, "rb") as fh:
            return fh.read().decode("utf-8", "replace")
    except OSError:
        return ""


def snapshot(step_no, prev_depth):
    frames = user_frames()
    newest = frames[0]
    line = newest.find_sal().line
    snap = Snapshot()
    stack = []
    for fidx, f in enumerate(reversed(frames)):  # oldest (main) first
        fl = f.find_sal().line
        stack.append({"func": f.function().name, "line": fl,
                      "vars": frame_vars(f, snap, fidx, fl if f != newest else line)})
    glob = globals_of(newest, snap)
    allb = heap_blocks()
    blocks = [b for b in allb if b["alive"]]
    for b in blocks:
        snap.objects.append((b["ptr"], b["ptr"] + max(b["size"], 1), {"kind": "heap", "id": b["id"]}))
    freed = [b for b in allb if not b["alive"]]
    typed = {}
    dangling_ids = set()
    # Worklist: heap blocks get their type from the first typed pointer to their start (like
    # Python Tutor), and rendering that block may discover more pointers.
    i = 0
    while i < len(snap.pointers):
        d, addr, tgt = snap.pointers[i]
        i += 1
        d["ref"] = snap.resolve(addr) if addr else None
        ref = d["ref"]
        if ref and ref["kind"] == "heap" and ref["offset"] == 0 and ref["id"] not in typed:
            b = next(b for b in blocks if b["id"] == ref["id"])
            st = tgt.strip_typedefs()
            if st.code == gdb.TYPE_CODE_VOID or st.sizeof == 0:
                continue
            n = max(b["size"] // st.sizeof, 1)
            p = gdb.Value(addr).cast(tgt.pointer())
            v = p.dereference() if n == 1 else p.cast(tgt.array(n - 1).pointer()).dereference()
            typed[b["id"]] = {"id": b["id"], "addr": fake(b["ptr"]), "size": b["size"],
                              "type": str(v.type), "value": snap.render(v)}
            add_init(typed[b["id"]], b["ptr"], b["size"], v.type)
        elif ref is None and addr:
            fb = next((b for b in reversed(freed) if b["ptr"] <= addr < b["ptr"] + max(b["size"], 1)), None)
            if fb:
                d["ref"] = {"kind": "freed", "id": fb["id"], "offset": addr - fb["ptr"]}
                dangling_ids.add(fb["id"])
            d["dangling"] = True
    referenced = {d["ref"]["id"] for d, _, _ in snap.pointers if d.get("ref") and d["ref"]["kind"] == "heap"}
    inf = gdb.selected_inferior()
    heap = []
    for b in allb:
        if b["alive"] and b["id"] in typed:
            heap.append(typed[b["id"]])
        elif b["alive"]:  # only reachable through void* (untyped) or not at all (leaked)
            raw = bytes(inf.read_memory(b["ptr"], min(b["size"], 256)))
            h = {"id": b["id"], "addr": fake(b["ptr"]), "size": b["size"], "value": {"t": "raw", "hex": raw.hex()}}
            if b["id"] not in referenced:
                h["unreferenced"] = True
            heap.append(h)
        elif b["id"] in dangling_ids:  # freed, but a pointer still holds its address
            heap.append({"id": b["id"], "addr": fake(b["ptr"]), "size": b["size"], "freed": True})
    depth = len(frames)
    event = "step"
    if prev_depth is not None and depth > prev_depth:
        event = "call"
    elif prev_depth is not None and depth < prev_depth:
        event = "return"
    st = {"i": step_no, "line": line, "func": newest.function().name, "event": event,
          "stack": stack, "globals": glob, "heap": heap, "stdout": read_text(STDOUT_FILE)}
    if at_closing_brace(newest):
        rv = return_value(newest)
        if rv is not None:
            st["return_value"] = rv
    return st, depth


# ---------------- main loop ----------------
ex("break main")
redir = " ".join(shlex.quote(a) for a in ARGS)
if VALGRIND:
    import subprocess
    import time
    vg = subprocess.Popen(
        ["valgrind", "--tool=memcheck", "--vgdb=yes", "--vgdb-error=0",
         "--vgdb-prefix=" + VG_PREFIX, "--log-file=" + OUT + ".vglog", PROG] + ARGS,
        stdin=open(STDIN), stdout=open(STDOUT_FILE, "w"), stderr=open(STDERR_FILE, "w"))
    anchors["vg_pid"] = vg.pid
    time.sleep(1.0)
    ex("target remote | vgdb --vgdb-prefix=%s --pid=%d" % (VG_PREFIX, vg.pid))
    ex("continue")
else:
    ex("run %s < %s > %s 2> %s" % (redir, shlex.quote(STDIN), shlex.quote(STDOUT_FILE), shlex.quote(STDERR_FILE)))
refresh_anchors()
anchors["main_cfa"] = frame_cfa(gdb.selected_frame())
steps, prev_depth, truncated = [], None, False
while True:
    if gdb.selected_inferior().pid == 0:
        break
    if state["signal"]:
        # Snapshot the state at the crash; fall back to the previous step if the stack is unreadable.
        try:
            s, _ = snapshot(len(steps), prev_depth)
        except Exception:
            prev = steps[-1] if steps else {"line": 0, "func": "main", "stack": [], "globals": [], "heap": []}
            s = {k: prev[k] for k in ("line", "func", "stack", "globals", "heap")}
            s["i"] = len(steps)
        s.pop("return_value", None)
        s.update({"event": "signal", "signal": state["signal"], "stdout": read_text(STDOUT_FILE)})
        steps.append(s)
        break
    frames = user_frames()
    if not frames:  # returned out of main into libc
        ex("continue")
        continue
    newest = gdb.newest_frame()
    if not is_user(newest):  # inside a library function that has line info
        f = newest
        while f.older() is not None and not is_user(f.older()):
            f = f.older()
        f.select()
        ex("finish")
        ex("step")
        continue
    if len(steps) >= MAX_STEPS:
        truncated = True
        break
    errs = new_vg_errors()
    if errs and steps:  # errors happened while executing the previous step's line
        steps[-1].setdefault("errors", []).extend(errs)
    s, prev_depth = snapshot(len(steps), prev_depth)
    if state["vg_errors"]:
        s.setdefault("errors", []).extend(state["vg_errors"])
    state["vg_errors"] = []
    steps.append(s)
    ex("step")

if gdb.selected_inferior().pid != 0:
    try:
        ex("kill")
    except gdb.error:
        pass

with open(SRC_PATH) as fh:
    source = fh.read()
trace = {
    "version": 1,
    "sample": SAMPLE,
    "platform": "linux-x86_64-gcc",
    "source": source,
    "steps": steps,
    "truncated": truncated,
    "exit_code": state["exit_code"],
    "signal": state["signal"],
}
with open(OUT, "w") as fh:
    json.dump(trace, fh, separators=(",", ":"))
print("TRACE_OK %d steps exit=%s signal=%s" % (len(steps), state["exit_code"], state["signal"]))
