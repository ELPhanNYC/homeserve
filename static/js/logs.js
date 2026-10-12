// Log viewer: lists files in logs/, tails the selected one, and polls for new lines.

const POLL_MS = 5000;

const card = document.querySelector('.log-card');
const $ = (id) => document.getElementById(id);
const fileSelect = $('log-file');
const view = $('log-view');

// "2026-10-12 14:14:13,047 INFO message" -- anything else continues the
// previous entry (tracebacks, werkzeug's multi-line startup banner)
const ENTRY = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}) (DEBUG|INFO|WARNING|ERROR|CRITICAL) (.*)$/;
const SEVERITY = { DEBUG: 0, INFO: 0, WARNING: 1, ERROR: 2, CRITICAL: 2 };
const HTTP_LINE = /^\S+ - - \[[^\]]+\] "[A-Z]+ /;
const ANSI = /\x1b\[[0-9;]*m/g;

let entries = [];
let timer = null;

function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function esc(s) {
    return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function parse(lines) {
    const out = [];
    for (const raw of lines) {
        const line = raw.replace(ANSI, '');
        const m = line.match(ENTRY);
        if (m) {
            out.push({ time: m[1], level: m[2], message: m[3] });
        } else if (out.length && out[out.length - 1].level) {
            out[out.length - 1].message += `\n${line}`;
        } else if (line.trim()) {
            // files without our format (e.g. ytdlp-update.log): one entry per line,
            // flagging the batch script's own [ERROR] markers
            out.push({ time: '', level: /\[ERROR\]/.test(line) ? 'ERROR' : '', message: line });
        }
    }
    // a traceback continuation is part of an error even if the first line wasn't
    for (const e of out) {
        if (e.level === 'INFO' && e.message.includes('\nTraceback')) e.level = 'ERROR';
    }
    return out;
}

function highlight(text, query) {
    if (!query) return esc(text);
    const lower = text.toLowerCase();
    let html = '';
    let i = 0;
    for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, i)) {
        html += `${esc(text.slice(i, at))}<mark>${esc(text.slice(at, at + query.length))}</mark>`;
        i = at + query.length;
    }
    return html + esc(text.slice(i));
}

function render() {
    const minLevel = Number($('log-level').value);
    const hideHttp = $('log-hide-http').checked;
    const query = $('log-search').value.trim().toLowerCase();

    const shown = entries.filter((e) =>
        (SEVERITY[e.level] ?? 0) >= minLevel &&
        !(hideHttp && HTTP_LINE.test(e.message)) &&
        (!query || e.message.toLowerCase().includes(query) || e.time.includes(query)));

    const errors = entries.filter((e) => SEVERITY[e.level] === 2).length;
    const warnings = entries.filter((e) => SEVERITY[e.level] === 1).length;
    $('log-counts').innerHTML =
        `<span class="badge crit">${errors} error${errors === 1 ? '' : 's'}</span>` +
        `<span class="badge warn">${warnings} warning${warnings === 1 ? '' : 's'}</span>` +
        `<span class="muted">${shown.length} of ${entries.length} shown</span>`;

    // stay pinned to the newest line unless the user has scrolled up
    const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 40;

    view.innerHTML = shown.length ? shown.map((e) => `
        <div class="log-entry ${e.level ? `lvl-${e.level.toLowerCase()}` : ''}">
            <span class="log-time">${esc(e.time)}</span>
            <span class="log-level">${esc(e.level)}</span>
            <span class="log-msg">${highlight(e.message, query)}</span>
        </div>`).join('') : '<p class="empty">No matching log entries.</p>';

    if (atBottom) view.scrollTop = view.scrollHeight;
}

async function loadFiles() {
    const res = await fetch(card.dataset.files, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Couldn't list log files (${res.status})`);
    const files = await res.json();
    const current = fileSelect.value;
    fileSelect.innerHTML = files.map((f) =>
        `<option value="${esc(f.name)}">${esc(f.name)} · ${formatBytes(f.size)}</option>`).join('');
    if (files.some((f) => f.name === current)) fileSelect.value = current;
}

async function loadLog() {
    const name = fileSelect.value;
    if (!name) {
        entries = [];
        render();
        return;
    }
    const base = `${card.dataset.files}/${encodeURIComponent(name)}`;
    $('log-download').href = `${base}/download`;
    const res = await fetch(`${base}?lines=${$('log-lines').value}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Couldn't read ${name} (${res.status})`);
    const data = await res.json();
    entries = parse(data.lines);
    render();
    const note = data.truncated ? ` · showing the last ${data.lines.length.toLocaleString()} lines` : '';
    $('log-status').textContent = `${name} · ${formatBytes(data.size)}${note} · updated ${new Date().toLocaleTimeString()}`;
}

async function refresh() {
    const status = $('log-status');
    clearTimeout(timer);
    try {
        await loadFiles();
        await loadLog();
        status.classList.remove('error');
    } catch (err) {
        status.classList.add('error');
        status.textContent = err.message;
    } finally {
        if ($('log-auto').checked && !document.hidden) timer = setTimeout(refresh, POLL_MS);
    }
}

fileSelect.addEventListener('change', () => {
    view.scrollTop = view.scrollHeight;
    refresh();
});
$('log-lines').addEventListener('change', refresh);
$('log-auto').addEventListener('change', refresh);
$('log-level').addEventListener('change', render);
$('log-hide-http').addEventListener('change', render);
$('log-search').addEventListener('input', render);

document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden) refresh();
});

refresh();
