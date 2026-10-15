# tracer.py -- build-time C execution tracer for a stack/heap visualizer.
# Run:  TRACE_PROG=./bin TRACE_SRC=prog.c TRACE_OUT=out.json [TRACE_STDIN=in.txt] \
#       gdb -q -nx -batch -x tracer.py
# Requires the program to be built with: -g -O0 -fno-omit-frame-pointer heap_shim.o
#   -Wl,--wrap=malloc,--wrap=free,--wrap=calloc,--wrap=realloc
import gdb, json, os, re, struct

PROG = os.environ["TRACE_PROG"]
SRC_PATH = os.environ["TRACE_SRC"]
SRC = os.path.basename(SRC_PATH)
OUT = os.environ["TRACE_OUT"]
STDIN = os.environ.get("TRACE_STDIN", "/dev/null")
MAX_STEPS = int(os.environ.get("TRACE_MAX_STEPS", "1000"))
MAX_ELEMS = 64
STDOUT_FILE = OUT + ".stdout"
STDERR_FILE = OUT + ".stderr"
# TRACE_VALGRIND=1: run under memcheck's gdbserver; adds per-byte definedness ("init")
VALGRIND = os.environ.get("TRACE_VALGRIND") == "1"
VG_PREFIX = OUT + ".vgdb"

# Fake, stable base addresses. Real address = anchor + off  ->  fake = FAKE + off
FAKE_STACK_TOP = 0x7FFC00002000   # main's CFA maps here; locals sit just below
FAKE_HEAP = 0x55500000            # [heap] mapping start maps here
FAKE_IMAGE = 0x400000             # executable load base maps here


def ex(cmd):
    return gdb.execute(cmd, to_string=True)


for c in ("set pagination off", "set confirm off", "set width 0",
          "set debuginfod enabled off",
          # do NOT load libc6-dbg symbols: keeps `step` from entering printf etc.
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
            # memcheck reported an error (invalid read, uninit jump, ...) and stopped
            state["vg_errors"].append(ex("monitor v.info last_error").strip())
        else:
            state["signal"] = ev.stop_signal


gdb.events.exited.connect(on_exit)
gdb.events.stop.connect(on_stop)


def alive():
    inf = gdb.selected_inferior()
    return inf is not None and inf.pid != 0 and state["signal"] is None or (
        state["signal"] is not None and inf.pid != 0)


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


# ---------- memory regions & address normalisation ----------
anchors = {}


def read_maps():
    pid = anchors.get("vg_pid") or gdb.selected_inferior().pid
    regs = []
    with open("/proc/%d/maps" % pid) as fh:
        for line in fh:
            parts = line.split()
            lo, hi = (int(x, 16) for x in parts[0].split("-"))
            name = parts[5] if len(parts) > 5 else ""
            regs.append((lo, hi, name))
    return regs


def refresh_anchors():
    regs = read_maps()
    prog_real = os.path.realpath(PROG)
    for lo, hi, name in regs:
        if name == "[heap]" and "heap" not in anchors:
            anchors["heap"] = (lo, hi)
        if name == "[stack]":
            anchors["stack_map"] = (lo, hi)
        if name == prog_real and "image" not in anchors:
            anchors["image"] = lo
    anchors["image_hi"] = max(hi for lo, hi, n in regs if n == prog_real)


def region_of(addr):
    if addr == 0:
        return "null"
    # stack: anything between 1 MiB below main's CFA and a page above it
    if anchors["main_cfa"] - (1 << 20) <= addr < anchors["main_cfa"] + 0x1000:
        return "stack"
    if "heap" not in anchors:
        hb = heap_blocks()
        if hb:   # anchor heap at the first tracked block (glibc: [heap]+0x2a0)
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
    return "0x?" + format(addr & 0xFFFF, "04x")   # libc/vdso/garbage: don't leak real bits


# ---------- heap registry (written by heap_shim.c) ----------
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
    """Return a per-byte mask string: 'd' defined, 'u' undefined, 'p' partially."""
    if not VALGRIND or addr is None or size == 0:
        return None
    try:
        outp = ex("monitor get_vbits 0x%x %d" % (addr, size))
    except gdb.error:
        return None
    hexs = "".join(outp.split())
    if not re.fullmatch(r"[0-9a-f]+", hexs):
        return None          # e.g. "Address ... not addressable"
    bs = bytes.fromhex(hexs)[:size]
    return "".join("d" if b == 0 else ("u" if b == 0xFF else "p") for b in bs)


def add_init(d, addr, size):
    m = vbits(addr, size)
    if m is not None:
        d["init"] = all(c == "d" for c in m)
        if not d["init"] and any(c == "d" for c in m):
            d["vbits"] = m


# ---------- value rendering ----------
SCALAR = (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_CHAR, gdb.TYPE_CODE_BOOL)


class Snapshot:
    def __init__(self):
        self.pointers = []     # (rendered dict, raw addr, target gdb.Type)
        self.objects = []      # (lo, hi, ref dict) for stack/global vars and heap blocks

    def render(self, val, depth=0):
        t = val.type.strip_typedefs()
        code = t.code
        try:
            if code in SCALAR:
                v = int(val)
                d = {"t": "int", "v": v}
                if code == gdb.TYPE_CODE_CHAR or (t.sizeof == 1 and t.name and "char" in t.name):
                    d["t"] = "char"
                    d["ch"] = chr(v & 0xFF) if 32 <= (v & 0xFF) < 127 else None
                if code == gdb.TYPE_CODE_BOOL:
                    d = {"t": "bool", "v": bool(v)}
                return d
            if code == gdb.TYPE_CODE_FLT:
                return {"t": "float", "v": float(val)}
            if code == gdb.TYPE_CODE_ENUM:
                return {"t": "enum", "v": int(val), "name": str(val)}
            if code == gdb.TYPE_CODE_PTR:
                addr = int(val)
                tgt = t.target()
                d = {"t": "ptr", "v": fake(addr), "ref": None}
                if tgt.strip_typedefs().code == gdb.TYPE_CODE_FUNC:
                    d["t"] = "funcptr"
                    d["fn"] = str(val).split("<")[-1].rstrip(">") if "<" in str(val) else None
                    return d
                self.pointers.append((d, addr, tgt))
                return d
            if code == gdb.TYPE_CODE_ARRAY:
                lo, hi = t.range()
                n = hi - lo + 1
                elems = [self.render(val[i], depth + 1) for i in range(lo, lo + min(n, MAX_ELEMS))]
                d = {"t": "array", "len": n, "elems": elems}
                et = t.target().strip_typedefs()
                if et.sizeof == 1 and et.code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_CHAR):
                    raw = bytes(int(val[i]) & 0xFF for i in range(lo, lo + n))
                    d["str"] = raw.split(b"\0")[0].decode("latin-1") if b"\0" in raw else None
                return d
            if code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
                fields = []
                for f in t.fields():
                    if not hasattr(f, "bitpos"):
                        continue
                    fields.append({"name": f.name, "type": str(f.type),
                                   "offset": f.bitpos // 8,
                                   "value": self.render(val[f], depth + 1)})
                return {"t": "struct" if code == gdb.TYPE_CODE_STRUCT else "union", "fields": fields}
        except gdb.MemoryError:
            return {"t": "unreadable"}
        return {"t": "other", "text": str(val)}

    def var(self, name, val, ref, **extra):
        addr = int(val.address) if val.address is not None else None
        size = val.type.sizeof
        if addr is not None:
            self.objects.append((addr, addr + size, ref))
        d = {"name": name, "type": str(val.type), "addr": fake(addr) if addr else None,
             "size": size, "value": self.render(val)}
        d.update(extra)
        add_init(d, addr, size)
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
    for b in reversed(blocks):          # outermost (params) first
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
            # crude "not yet initialised" heuristic: declaration line not yet reached
            declared = sym.is_argument or static or sym.line < cur_line
            out.append(snap.var(sym.name, val, ref, param=sym.is_argument,
                                static=static, declared=declared))
    return out


def globals_of(frame, snap):
    out = []
    blk = frame.block()
    for b in (blk.global_block, blk.static_block):
        for sym in b:
            if sym.is_variable and sym.symtab and os.path.basename(sym.symtab.filename) == SRC:
                val = sym.value()
                out.append(snap.var(sym.name, val, {"kind": "global", "name": sym.name},
                                    static=(b is blk.static_block)))
    return out


def at_closing_brace(frame):
    blk = frame.block()
    while blk.function is None:
        blk = blk.superblock
    return frame.find_sal().line == gdb.find_pc_line(blk.end - 1).line


def return_value(frame):
    rt = frame.function().type.target().strip_typedefs()
    if rt.code == gdb.TYPE_CODE_VOID:
        return None
    if rt.code in SCALAR + (gdb.TYPE_CODE_PTR, gdb.TYPE_CODE_ENUM):
        frame.select()
        return Snapshot().render(gdb.parse_and_eval("$rax").cast(rt))
    if rt.code == gdb.TYPE_CODE_FLT:
        frame.select()
        return Snapshot().render(gdb.parse_and_eval("$xmm0.v2_double[0]").cast(rt))
    return {"t": "other", "text": "(aggregate return not captured)"}


VG_NOISE = ("(action on error)", "(action at startup)", "Continuing", "HEAP SUMMARY",
            "LEAK SUMMARY", "For lists of", "ERROR SUMMARY", "All heap blocks", "in use at exit",
            "total heap usage", "TO DEBUG", "Memcheck,", "Copyright", "Using Valgrind", "Command:",
            "Parent PID", "and then give", "--pid is optional", "/path/to/gdb", "target remote")


def new_vg_errors():
    """memcheck errors written to the log since the last call (gdb's `step` swallows
    the SIGTRAP that vgdb sends on error, so we read the log instead)."""
    if not VALGRIND:
        return []
    path = OUT + ".vglog"
    try:
        with open(path) as fh:
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
        # keep only frames in the learner's file; drop shim/libc frames
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
    for fidx, f in enumerate(reversed(frames)):        # oldest (main) first
        fl = f.find_sal().line
        stack.append({"func": f.function().name, "line": fl,
                      "vars": frame_vars(f, snap, fidx, fl if f != newest else line)})
    glob = globals_of(newest, snap)
    # heap: register objects first so pointers can resolve to them
    allb = heap_blocks()
    blocks = [b for b in allb if b["alive"]]
    for b in blocks:
        snap.objects.append((b["ptr"], b["ptr"] + max(b["size"], 1), {"kind": "heap", "id": b["id"]}))
    freed = [b for b in allb if not b["alive"]]
    heap_out = {}
    # worklist: type heap blocks from incoming typed pointers (like Python Tutor)
    i = 0
    while i < len(snap.pointers):
        d, addr, tgt = snap.pointers[i]
        i += 1
        d["ref"] = snap.resolve(addr) if addr else None
        ref = d["ref"]
        if ref and ref["kind"] == "heap" and ref["offset"] == 0 and ref["id"] not in heap_out:
            b = next(b for b in blocks if b["id"] == ref["id"])
            st = tgt.strip_typedefs()
            if st.code == gdb.TYPE_CODE_VOID or st.sizeof == 0:
                continue
            n = max(b["size"] // st.sizeof, 1)
            p = gdb.Value(addr).cast(tgt.pointer())
            v = p.dereference() if n == 1 else p.cast(tgt.array(n - 1).pointer()).dereference()
            heap_out[b["id"]] = {"id": b["id"], "addr": fake(b["ptr"]), "size": b["size"],
                                 "type": str(v.type), "value": snap.render(v)}
            add_init(heap_out[b["id"]], b["ptr"], b["size"])
        elif d["ref"] is None and addr:
            # points into a block that was already freed? (newest freed block wins)
            fb = next((b for b in reversed(freed) if b["ptr"] <= addr < b["ptr"] + max(b["size"], 1)), None)
            if fb:
                d["ref"] = {"kind": "freed", "id": fb["id"], "offset": addr - fb["ptr"]}
            d["dangling"] = True
    referenced = {d["ref"]["id"] for d, _, _ in snap.pointers
                  if d.get("ref") and d["ref"]["kind"] == "heap"}
    inf = gdb.selected_inferior()
    heap = []
    for b in blocks:
        if b["id"] in heap_out:
            heap.append(heap_out[b["id"]])
        else:   # untyped (void*-only or unreferenced => leaked)
            raw = bytes(inf.read_memory(b["ptr"], min(b["size"], 256)))
            heap.append({"id": b["id"], "addr": fake(b["ptr"]), "size": b["size"],
                         "type": None, "bytes": raw.hex(),
                         "unreferenced": b["id"] not in referenced})
    depth = len(frames)
    event = "step"
    if prev_depth is not None and depth > prev_depth:
        event = "call"
    elif prev_depth is not None and depth < prev_depth:
        event = "return"
    st = {"i": step_no, "line": line, "func": newest.function().name, "event": event,
          "vg_errors": state["vg_errors"][:],
          "stack": stack, "globals": glob, "heap": heap, "stdout": read_text(STDOUT_FILE)}
    if at_closing_brace(newest):
        rv = return_value(newest)
        if rv is not None:
            st["return_value"] = rv
    return st, depth


# ---------------- main loop ----------------
ex("break main")
if VALGRIND:
    import subprocess, time
    vg = subprocess.Popen(
        ["valgrind", "--tool=memcheck", "--vgdb=yes", "--vgdb-error=0",
         "--vgdb-prefix=" + VG_PREFIX, "--log-file=" + OUT + ".vglog", PROG],
        stdin=open(STDIN), stdout=open(STDOUT_FILE, "w"), stderr=open(STDERR_FILE, "w"))
    anchors["vg_pid"] = vg.pid
    time.sleep(1.0)
    ex("target remote | vgdb --vgdb-prefix=%s --pid=%d" % (VG_PREFIX, vg.pid))
    ex("continue")
else:
    ex("run < %s > %s 2> %s" % (STDIN, STDOUT_FILE, STDERR_FILE))
refresh_anchors()
anchors["main_cfa"] = frame_cfa(gdb.selected_frame())
steps, prev_depth, truncated = [], None, False
while True:
    if gdb.selected_inferior().pid == 0:
        break
    if state["signal"]:
        steps.append({"i": len(steps), "event": "signal", "signal": state["signal"],
                      "line": steps[-1]["line"] if steps else None,
                      "stdout": read_text(STDOUT_FILE)})
        break
    frames = user_frames()
    if not frames:                 # returned out of main into libc
        ex("continue")
        continue
    newest = gdb.newest_frame()
    if not is_user(newest):        # inside a library function that has line info
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
    if errs and steps:          # errors happened while executing the previous step's line
        steps[-1].setdefault("errors", []).extend(errs)
    s, prev_depth = snapshot(len(steps), prev_depth)
    if not s["vg_errors"]:
        del s["vg_errors"]
    state["vg_errors"] = []
    steps.append(s)
    ex("step")

if gdb.selected_inferior().pid != 0:
    try:
        ex("kill")
    except gdb.error:
        pass

trace = {
    "version": 1,
    "file": SRC,
    "source": open(SRC_PATH).read(),
    "steps": steps,
    "truncated": truncated,
    "exit_code": state["exit_code"],
    "signal": state["signal"],
    "stdout": read_text(STDOUT_FILE),
    "stderr": read_text(STDERR_FILE),
    "address_model": {"stack_top": hex(FAKE_STACK_TOP), "heap_base": hex(FAKE_HEAP),
                      "image_base": hex(FAKE_IMAGE),
                      "note": "addresses are rebased per region; offsets are real"},
}
with open(OUT, "w") as fh:
    json.dump(trace, fh, separators=(",", ":"))
print("wrote %s: %d steps, exit=%s" % (OUT, len(steps), state["exit_code"]))
