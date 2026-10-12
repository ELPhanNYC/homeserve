import platform
import socket
import threading
import time
from collections import deque
import psutil

# psutil remembers the previous cpu_percent() sample per thread (and per
# Process object), and Flask serves each request on a new thread -- so calling
# it from a request always reads 0.0. Everything rate-based is sampled from one
# long-lived thread and requests just read the latest snapshot.
_SAMPLE_SECS = 2
_HISTORY_SECS = 300
# a full process scan costs ~1.5s on Windows (protected processes fall back to
# a slow system-wide query), so it runs less often on its own thread
_PROCESS_SECS = 10
_TOP_PROCESSES = 15

_lock = threading.Lock()
_history = deque(maxlen=_HISTORY_SECS // _SAMPLE_SECS)
_snapshot = {"per_core": [], "times": {}}
_processes_latest = []

def _cpu_times(times):
    # fold platform-specific fields (irq, dpc, iowait, nice, ...) into "other"
    d = times._asdict()
    user, system, idle = d.pop("user"), d.pop("system"), d.pop("idle")
    return {"user": user, "system": system, "other": sum(d.values()), "idle": idle}

def _processes(cores):
    procs = []
    for p in psutil.process_iter(["name"]):
        if p.pid == 0:  # "System Idle Process" reports idle time as its CPU
            continue
        try:
            # process_iter reuses Process objects, so this compares against
            # this thread's previous pass
            with p.oneshot():
                cpu = p.cpu_percent(interval=None) / cores
                mem = p.memory_info()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        procs.append({
            "pid": p.pid,
            "name": p.info["name"] or "?",
            "cpu": cpu,
            "rss": mem.rss,
        })
    # union of the top N by each column, so the page can sort by either
    by_cpu = sorted(procs, key=lambda x: x["cpu"], reverse=True)[:_TOP_PROCESSES]
    by_mem = sorted(procs, key=lambda x: x["rss"], reverse=True)[:_TOP_PROCESSES]
    return list({p["pid"]: p for p in by_cpu + by_mem}.values())

def _sample():
    global _snapshot
    while True:
        try:
            per_core = psutil.cpu_percent(interval=_SAMPLE_SECS, percpu=True)
            times = _cpu_times(psutil.cpu_times_percent(interval=None))
            mem = psutil.virtual_memory().percent
        except Exception:
            time.sleep(_SAMPLE_SECS)
            continue
        cpu = sum(per_core) / len(per_core)
        with _lock:
            _snapshot = {"per_core": per_core, "times": times}
            _history.append({"t": time.time(), "cpu": cpu, "mem": mem})

def _sample_processes():
    global _processes_latest
    cores = psutil.cpu_count() or 1
    while True:
        try:
            _processes_latest = _processes(cores)
        except Exception:
            pass
        time.sleep(_PROCESS_SECS)

threading.Thread(target=_sample, name="metrics-sampler", daemon=True).start()
threading.Thread(target=_sample_processes, name="process-sampler", daemon=True).start()

def _disks():
    disks = []
    for part in psutil.disk_partitions(all=False):
        # skip empty card readers / optical drives, which raise on Windows
        if "cdrom" in part.opts or not part.fstype:
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except (PermissionError, OSError):
            continue
        disks.append({
            "mount": part.mountpoint,
            "fstype": part.fstype,
            "total": usage.total,
            "used": usage.used,
            "free": usage.free,
            "percent": usage.percent,
        })
    return disks

def _interfaces():
    stats = psutil.net_if_stats()
    nics = []
    for name, io in psutil.net_io_counters(pernic=True).items():
        st = stats.get(name)
        # hide loopback/virtual adapters that are down or have never moved data
        if not st or not st.isup or (io.bytes_sent == 0 and io.bytes_recv == 0):
            continue
        nics.append({
            "name": name,
            "speed_mbps": st.speed or None,
            "sent": io.bytes_sent,
            "recv": io.bytes_recv,
        })
    return nics

def getMetrics():
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    net = psutil.net_io_counters()
    freq = psutil.cpu_freq()
    with _lock:
        snap = _snapshot
        history = list(_history)

    per_core = snap["per_core"]
    return {
        "hostname": socket.gethostname(),
        "os": platform.platform(terse=True),
        "timestamp": time.time(),
        "boot_time": psutil.boot_time(),
        "uptime": time.time() - psutil.boot_time(),
        "cpu": {
            "percent": sum(per_core) / len(per_core) if per_core else 0.0,
            "per_core": per_core,
            "times": snap["times"],
            "cores": psutil.cpu_count(logical=False),
            "threads": psutil.cpu_count(logical=True),
            "freq_mhz": freq.current if freq else None,
        },
        "memory": {
            "total": mem.total,
            "used": mem.total - mem.available,
            "percent": mem.percent,
        },
        "swap": {
            "total": swap.total,
            "used": swap.used,
            "percent": swap.percent,
        },
        "disks": _disks(),
        # cumulative counters; the page derives throughput between polls
        "network": {
            "sent": net.bytes_sent,
            "recv": net.bytes_recv,
            "interfaces": _interfaces(),
        },
        "history": history,
        "processes": _processes_latest,
        "process_count": len(psutil.pids()),
    }
