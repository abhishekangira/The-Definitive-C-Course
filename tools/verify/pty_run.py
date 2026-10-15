#!/usr/bin/env python3
"""pty_run.py - run a native sample the way the browser runs it (stdlib only, Linux and macOS).

  python3 pty_run.py [--timeout-ms N] [--max-bytes N] [--stdout tty|pipe] [--cwd DIR]
                     [--env K=V ...] -- PROGRAM [ARGS...]

* stdin:  this script's own stdin (a pipe from the verifier) is passed straight to the child.
* stdout: a pseudo-terminal by default, because the browser's stdout reports itself as a tty, so
          stdio line-buffers the same way (a crash after printf("x\\n") still shows "x").
          Output post-processing is switched off on the pty (no \\n -> \\r\\n), so the bytes
          are exactly what the program wrote, like the browser. --stdout pipe uses a plain pipe.
* stderr: a separate pipe.
* The child gets only the --env variables (the browser has an empty environment).
* On timeout or when more than --max-bytes are produced the child's process group is killed.

Prints one JSON object: {stdout_b64, stderr_b64, exit, signal, timedOut, outputLimit, ms}.
Output is base64 so invalid UTF-8 survives; the verifier decodes it like the browser does.
"""
import argparse
import base64
import errno
import json
import os
import select
import signal
import subprocess
import sys
import termios
import time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout-ms", type=int, default=3000)
    ap.add_argument("--max-bytes", type=int, default=1 << 20)
    ap.add_argument("--stdout", choices=("tty", "pipe"), default="tty")
    ap.add_argument("--cwd", default=None)
    ap.add_argument("--env", action="append", default=[])
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd
    if not cmd:
        ap.error("missing program")
    env = dict(kv.split("=", 1) for kv in a.env)

    if a.stdout == "tty":
        master, slave = os.openpty()
        attrs = termios.tcgetattr(slave)
        attrs[1] &= ~termios.OPOST  # oflag: write bytes unchanged (no ONLCR)
        termios.tcsetattr(slave, termios.TCSANOW, attrs)
        out_target = slave
    else:
        master, slave = None, None
        out_target = subprocess.PIPE

    t0 = time.monotonic()
    proc = subprocess.Popen(cmd, stdin=sys.stdin.fileno(), stdout=out_target, stderr=subprocess.PIPE,
                            cwd=a.cwd, env=env, start_new_session=True, close_fds=True)
    # Keep our copy of the slave open until the output has been drained. macOS discards output the master
    # has not read yet when the last slave descriptor closes, which loses the output of fast programs
    # (Linux keeps it). So the end of the program is detected with poll(), not by EOF/EIO on the master.
    out_fd = master if master is not None else proc.stdout.fileno()
    err_fd = proc.stderr.fileno()
    bufs = {out_fd: bytearray(), err_fd: bytearray()}
    open_fds = {out_fd, err_fd}
    deadline = t0 + a.timeout_ms / 1000.0
    timed_out = False
    output_limit = False

    def kill():
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass

    while open_fds:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            kill()
            break
        ready, _, _ = select.select(list(open_fds), [], [], min(remaining, 0.05))
        for fd in ready:
            try:
                chunk = os.read(fd, 65536)
            except OSError as e:
                if e.errno == errno.EIO:  # pty: every slave descriptor was closed
                    chunk = b""
                else:
                    raise
            if not chunk:
                open_fds.discard(fd)
                continue
            bufs[fd] += chunk
            if len(bufs[out_fd]) + len(bufs[err_fd]) > a.max_bytes:
                output_limit = True
        if output_limit:
            kill()
            break
        if not ready and proc.poll() is not None:
            # The child exited and everything it wrote has been read. A grandchild may still hold the pty or
            # the stderr pipe open; stop waiting for it.
            break

    try:
        proc.wait(timeout=max(0.1, deadline - time.monotonic()) if not timed_out else 1)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill()
        proc.wait()
    # Drain whatever is still buffered after the child died.
    for fd in list(bufs):
        try:
            while True:
                r, _, _ = select.select([fd], [], [], 0)
                if not r:
                    break
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                bufs[fd] += chunk
        except OSError:
            pass
    ms = int((time.monotonic() - t0) * 1000)
    if slave is not None:
        os.close(slave)
    if master is not None:
        os.close(master)

    code = proc.returncode
    sig = None
    exit_code = code
    if code is not None and code < 0:
        try:
            sig = signal.Signals(-code).name
        except ValueError:
            sig = "SIG%d" % -code
        exit_code = None
    if output_limit:
        sig, exit_code = "output-limit", None
    elif timed_out:
        sig, exit_code = None, None

    cap = a.max_bytes
    json.dump({
        "stdout_b64": base64.b64encode(bytes(bufs[out_fd][:cap])).decode("ascii"),
        "stderr_b64": base64.b64encode(bytes(bufs[err_fd][:cap])).decode("ascii"),
        "exit": exit_code,
        "signal": sig,
        "timedOut": timed_out,
        "outputLimit": output_limit,
        "ms": ms,
    }, sys.stdout)


if __name__ == "__main__":
    main()
