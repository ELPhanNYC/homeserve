import os

_BLOCK = 64 * 1024

def _sort_key(entry):
    # live logs first (app.log, ytdlp-update.log), then rotated backups newest first
    name = entry["name"]
    is_backup = not name.endswith(".log")
    return (is_backup, -entry["modified"] if is_backup else 0, name)

def listLogs(log_dir):
    entries = []
    for name in os.listdir(log_dir):
        path = os.path.join(log_dir, name)
        if not os.path.isfile(path):
            continue
        st = os.stat(path)
        entries.append({"name": name, "size": st.st_size, "modified": st.st_mtime})
    return sorted(entries, key=_sort_key)

def resolveLog(log_dir, name):
    # only names that actually exist in the log folder -- never a caller-built path
    if name not in os.listdir(log_dir):
        return None
    path = os.path.join(log_dir, name)
    return path if os.path.isfile(path) else None

def tailLog(path, max_lines):
    # read backwards in blocks so a large log doesn't get loaded whole
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = pos = f.tell()
        data = b""
        while pos > 0 and data.count(b"\n") <= max_lines:
            step = min(_BLOCK, pos)
            pos -= step
            f.seek(pos)
            data = f.read(step) + data

    lines = data.decode("utf-8", errors="replace").splitlines()
    truncated = pos > 0 or len(lines) > max_lines
    if pos > 0:
        lines = lines[1:]  # first line is probably cut mid-way
    return {
        "lines": lines[-max_lines:],
        "size": size,
        "truncated": truncated,
    }
