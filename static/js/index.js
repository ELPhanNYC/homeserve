// Home page: polls /metrics and renders the System dashboard.

const POLL_MS = 5000;
const SVG_NS = 'http://www.w3.org/2000/svg';

// One hue per entity, validated for colorblind separation on the dark card
// surface. Status colors are reserved for thresholds and always get a label.
const COLORS = {
    cpu: '#8b5cf6',
    mem: '#0891b2',
    disk: '#db2777',
    track: 'rgba(255, 255, 255, 0.08)',
    warn: '#f59e0b',
    crit: '#ef4444',
};

const dash = document.querySelector('.dashboard');
const tooltip = document.getElementById('tooltip');
const $ = (id) => document.getElementById(id);

let latest = null;
let lastNet = null;
let rates = { total: null, nics: {} };
let procSort = 'cpu';
let timer = null;

// ---------- formatting ----------

function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const formatRate = (bps) => (bps == null ? '–' : `${formatBytes(bps)}/s`);
const pct = (n) => `${n.toFixed(0)}%`;

function formatUptime(secs) {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

const formatClock = (t) =>
    new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function level(percent) {
    if (percent >= 90) return { key: 'crit', label: 'Critical' };
    if (percent >= 75) return { key: 'warn', label: 'High' };
    return null;
}

// ---------- tooltip (any element with data-tip) ----------

function showTip(text, x, y) {
    tooltip.textContent = text;
    tooltip.hidden = false;
    const pad = 12;
    const { width, height } = tooltip.getBoundingClientRect();
    const left = Math.min(x + pad, window.innerWidth - width - 8);
    const top = y - height - pad < 8 ? y + pad : y - height - pad;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

const hideTip = () => { tooltip.hidden = true; };

dash.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el.dataset.tip, e.clientX, e.clientY);
    else if (!e.target.closest('.history-overlay')) hideTip();
});
dash.addEventListener('mouseleave', hideTip);

// ---------- donut gauges ----------

function donut(segments, { size = 120, stroke = 12, gap = 0 } = {}) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const mid = size / 2;
    let offset = 0;
    const arcs = segments.map((s) => {
        const len = (s.value / 100) * c;
        const drawn = Math.max(0, len - gap);
        const arc = drawn > 0.5
            ? `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${s.color}"
                 stroke-width="${stroke}" stroke-dasharray="${drawn} ${c}"
                 stroke-dashoffset="${-offset}" transform="rotate(-90 ${mid} ${mid})"
                 ${s.tip ? `data-tip="${esc(s.tip)}"` : ''} class="donut-seg"/>`
            : '';
        offset += len;
        return arc;
    }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" class="donut" aria-hidden="true">
        <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${COLORS.track}" stroke-width="${stroke}"/>
        ${arcs}</svg>`;
}

function gaugeCard({ label, percent, detail, color }) {
    const lv = level(percent);
    const fill = lv ? COLORS[lv.key] : color;
    const tip = `${label}: ${percent.toFixed(1)}%\n${detail}`;
    return `<div class="card gauge" data-tip="${esc(tip)}">
        <div class="gauge-ring">
            ${donut([{ value: percent, color: fill }])}
            <div class="gauge-value">${pct(percent)}</div>
        </div>
        <div class="gauge-label">
            <span class="swatch" style="background:${color}"></span>${esc(label)}
            ${lv ? `<span class="badge ${lv.key}">${lv.label}</span>` : ''}
        </div>
        <div class="gauge-detail">${esc(detail)}</div>
    </div>`;
}

function renderGauges(m) {
    const freq = m.cpu.freq_mhz ? ` · ${(m.cpu.freq_mhz / 1000).toFixed(2)} GHz` : '';
    const cards = [
        gaugeCard({
            label: 'CPU', percent: m.cpu.percent, color: COLORS.cpu,
            detail: `${m.cpu.cores} cores / ${m.cpu.threads} threads${freq}`,
        }),
        gaugeCard({
            label: 'Memory', percent: m.memory.percent, color: COLORS.mem,
            detail: `${formatBytes(m.memory.used)} of ${formatBytes(m.memory.total)}`,
        }),
        ...m.disks.map((d) => gaugeCard({
            label: `Disk ${d.mount}`, percent: d.percent, color: COLORS.disk,
            detail: `${formatBytes(d.free)} free of ${formatBytes(d.total)}`,
        })),
    ];
    if (m.swap.total) {
        cards.push(gaugeCard({
            label: 'Swap', percent: m.swap.percent, color: COLORS.disk,
            detail: `${formatBytes(m.swap.used)} of ${formatBytes(m.swap.total)}`,
        }));
    }
    $('gauges').innerHTML = cards.join('');
}

// ---------- CPU time pie ----------

function renderCpuPie(m) {
    const t = m.cpu.times;
    if (!t || t.idle == null) {
        $('cpu-pie').innerHTML = '<p class="empty">Collecting…</p>';
        return;
    }
    const slices = [
        { name: 'User', value: t.user, color: COLORS.cpu },
        { name: 'System', value: t.system, color: COLORS.mem },
        { name: 'Other (IRQ, DPC…)', value: t.other, color: COLORS.disk },
        { name: 'Idle', value: t.idle, color: COLORS.track },
    ].map((s) => ({ ...s, tip: `${s.name}: ${s.value.toFixed(1)}%` }));

    const busy = 100 - t.idle;
    $('cpu-pie').innerHTML = `
        <div class="gauge-ring pie-ring">
            ${donut(slices, { size: 160, stroke: 26, gap: 2 })}
            <div class="gauge-value">${pct(busy)}<small>busy</small></div>
        </div>
        <ul class="pie-legend">
            ${slices.map((s) => `<li data-tip="${esc(s.tip)}">
                <span class="swatch ${s.name === 'Idle' ? 'swatch-idle' : ''}" style="background:${s.color}"></span>
                <span>${esc(s.name)}</span><span class="num">${s.value.toFixed(1)}%</span>
            </li>`).join('')}
        </ul>`;
}

// ---------- history line chart ----------

function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

function renderHistory(m) {
    const host = $('history-chart');
    const pts = m.history;
    const series = [
        { key: 'cpu', name: 'CPU', color: COLORS.cpu },
        { key: 'mem', name: 'Memory', color: COLORS.mem },
    ];

    const last = pts[pts.length - 1];
    $('history-legend').innerHTML = series.map((s) => `
        <span class="legend-item"><span class="swatch line" style="background:${s.color}"></span>
        ${s.name}<strong>${last ? pct(last[s.key]) : '–'}</strong></span>`).join('');

    if (pts.length < 2) {
        host.innerHTML = '<p class="empty">Collecting samples…</p>';
        return;
    }

    const W = host.clientWidth;
    const H = 220;
    const M = { top: 10, right: 12, bottom: 24, left: 38 };
    const iw = W - M.left - M.right;
    const ih = H - M.top - M.bottom;
    const t0 = pts[0].t;
    const t1 = last.t;
    const x = (t) => M.left + ((t - t0) / Math.max(1, t1 - t0)) * iw;
    const y = (v) => M.top + ih - (v / 100) * ih;

    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img',
        'aria-label': `CPU and memory usage over the last ${Math.round((t1 - t0) / 60)} minutes` });

    for (const v of [0, 25, 50, 75, 100]) {
        svg.append(svgEl('line', { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v),
            class: v === 0 ? 'axis' : 'grid' }));
        const label = svgEl('text', { x: M.left - 8, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' });
        label.textContent = `${v}%`;
        svg.append(label);
    }
    for (const [t, anchor] of [[t0, 'start'], [t1, 'end']]) {
        const label = svgEl('text', { x: x(t), y: H - 6, class: 'tick', 'text-anchor': anchor });
        label.textContent = formatClock(t);
        svg.append(label);
    }

    for (const s of series) {
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join('');
        svg.append(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2,
            'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }

    // crosshair + tooltip
    const cross = svgEl('line', { y1: M.top, y2: M.top + ih, class: 'crosshair', visibility: 'hidden' });
    const dots = series.map((s) => svgEl('circle', { r: 4, fill: s.color, class: 'dot', visibility: 'hidden' }));
    const overlay = svgEl('rect', { x: M.left, y: M.top, width: iw, height: ih,
        fill: 'transparent', class: 'history-overlay' });
    svg.append(cross, ...dots, overlay);

    overlay.addEventListener('mousemove', (e) => {
        const box = svg.getBoundingClientRect();
        const mx = e.clientX - box.left;
        const tAt = t0 + ((mx - M.left) / iw) * (t1 - t0);
        let best = pts[0];
        for (const p of pts) if (Math.abs(p.t - tAt) < Math.abs(best.t - tAt)) best = p;
        const px = x(best.t);
        cross.setAttribute('x1', px);
        cross.setAttribute('x2', px);
        cross.setAttribute('visibility', 'visible');
        series.forEach((s, i) => {
            dots[i].setAttribute('cx', px);
            dots[i].setAttribute('cy', y(best[s.key]));
            dots[i].setAttribute('visibility', 'visible');
        });
        showTip(`${new Date(best.t * 1000).toLocaleTimeString()}\n` +
            series.map((s) => `${s.name}: ${best[s.key].toFixed(1)}%`).join('\n'), e.clientX, e.clientY);
    });
    overlay.addEventListener('mouseleave', () => {
        cross.setAttribute('visibility', 'hidden');
        dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
        hideTip();
    });

    host.replaceChildren(svg);
}

// ---------- per-core bar chart ----------

function topRoundedBar(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function renderCores(m) {
    const host = $('core-chart');
    const cores = m.cpu.per_core;
    if (!cores.length) {
        host.innerHTML = '<p class="empty">Collecting…</p>';
        return;
    }
    const busiest = cores.indexOf(Math.max(...cores));
    $('core-note').textContent = `Busiest: core ${busiest} at ${pct(cores[busiest])}`;

    const W = host.clientWidth;
    const H = 170;
    const M = { top: 10, right: 12, bottom: 22, left: 38 };
    const iw = W - M.left - M.right;
    const ih = H - M.top - M.bottom;
    const slot = iw / cores.length;
    const bw = Math.max(4, Math.min(48, slot - 2));
    const y = (v) => M.top + ih - (v / 100) * ih;

    const grid = [0, 50, 100].map((v) => `
        <line x1="${M.left}" x2="${W - M.right}" y1="${y(v)}" y2="${y(v)}" class="${v ? 'grid' : 'axis'}"/>
        <text x="${M.left - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}%</text>`).join('');

    const showLabels = slot >= 16;
    const bars = cores.map((v, i) => {
        const cx = M.left + slot * i + slot / 2;
        const h = Math.max(0, (v / 100) * ih);
        const lv = level(v);
        return `<g data-tip="Core ${i}: ${v.toFixed(1)}%${lv ? ` (${lv.label})` : ''}">
            <rect x="${cx - slot / 2}" y="${M.top}" width="${slot}" height="${ih}" fill="transparent"/>
            ${h > 0 ? `<path d="${topRoundedBar(cx - bw / 2, y(v), bw, h, 4)}" fill="${lv ? COLORS[lv.key] : COLORS.cpu}"/>` : ''}
            ${showLabels ? `<text x="${cx}" y="${H - 6}" class="tick" text-anchor="middle">${i}</text>` : ''}
        </g>`;
    }).join('');

    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="Load per logical core">${grid}${bars}</svg>`;
}

// ---------- tables ----------

function renderProcesses(m) {
    const rows = [...m.processes]
        .sort((a, b) => b[procSort] - a[procSort] || a.name.localeCompare(b.name))
        .slice(0, 10);
    const maxCpu = Math.max(1, ...rows.map((p) => p.cpu));
    const maxRss = Math.max(1, ...rows.map((p) => p.rss));
    $('proc-note').textContent = `${m.process_count} running · sorted by ${procSort === 'cpu' ? 'CPU' : 'memory'}`;

    $('proc-rows').innerHTML = rows.length ? rows.map((p) => `<tr>
        <td class="name" title="${esc(p.name)}">${esc(p.name)}</td>
        <td class="num muted">${p.pid}</td>
        <td class="num"><span class="cell-bar" style="--w:${(p.cpu / maxCpu) * 100}%;--c:${COLORS.cpu}"></span>${p.cpu.toFixed(1)}%</td>
        <td class="num"><span class="cell-bar" style="--w:${(p.rss / maxRss) * 100}%;--c:${COLORS.mem}"></span>${formatBytes(p.rss)}</td>
    </tr>`).join('') : '<tr><td colspan="4" class="empty">Collecting…</td></tr>';
}

function renderDisks(m) {
    $('disk-rows').innerHTML = m.disks.map((d) => {
        const lv = level(d.percent);
        return `<tr data-tip="${esc(`${d.mount} (${d.fstype}): ${d.percent.toFixed(1)}% used`)}">
            <td><strong>${esc(d.mount)}</strong> <span class="muted">${esc(d.fstype)}</span>
                <div class="row-meter"><span style="width:${d.percent}%;background:${lv ? COLORS[lv.key] : COLORS.disk}"></span></div></td>
            <td class="num">${formatBytes(d.used)}</td>
            <td class="num">${formatBytes(d.free)}</td>
            <td class="num muted">${formatBytes(d.total)}</td>
        </tr>`;
    }).join('');
}

function renderNetwork(m) {
    // counters are cumulative, so throughput is the delta since the last poll
    if (lastNet) {
        const secs = m.timestamp - lastNet.timestamp;
        const rate = (now, before) => Math.max(0, now - before) / secs;
        rates.total = { recv: rate(m.network.recv, lastNet.recv), sent: rate(m.network.sent, lastNet.sent) };
        rates.nics = {};
        for (const n of m.network.interfaces) {
            const prev = lastNet.nics[n.name];
            if (prev) rates.nics[n.name] = { recv: rate(n.recv, prev.recv), sent: rate(n.sent, prev.sent) };
        }
    }
    lastNet = {
        timestamp: m.timestamp,
        recv: m.network.recv,
        sent: m.network.sent,
        nics: Object.fromEntries(m.network.interfaces.map((n) => [n.name, n])),
    };

    $('net-recv').textContent = formatRate(rates.total?.recv);
    $('net-sent').textContent = formatRate(rates.total?.sent);
    $('nic-rows').innerHTML = m.network.interfaces.map((n) => {
        const r = rates.nics[n.name];
        const speed = n.speed_mbps ? `${n.speed_mbps} Mbps link` : 'link speed unknown';
        const tip = `${n.name} · ${speed}\nTotal ↓ ${formatBytes(n.recv)} · ↑ ${formatBytes(n.sent)}`;
        return `<tr data-tip="${esc(tip)}">
            <td class="name">${esc(n.name)}</td>
            <td class="num">${r ? formatBytes(r.recv) : '–'}</td>
            <td class="num">${r ? formatBytes(r.sent) : '–'}</td>
        </tr>`;
    }).join('');
}

document.querySelectorAll('#proc-table .sort').forEach((btn) => {
    btn.addEventListener('click', () => {
        procSort = btn.dataset.sort;
        document.querySelectorAll('#proc-table .sort').forEach((b) =>
            b.setAttribute('aria-pressed', String(b === btn)));
        if (latest) renderProcesses(latest);
    });
});

// ---------- polling ----------

function render(m) {
    $('dash-meta').textContent =
        `${m.hostname} · ${m.os} · up ${formatUptime(m.uptime)} · booted ${new Date(m.boot_time * 1000).toLocaleString()}`;
    renderGauges(m);
    renderHistory(m);
    renderCpuPie(m);
    renderCores(m);
    renderNetwork(m);
    renderProcesses(m);
    renderDisks(m);
}

async function poll() {
    const status = $('dash-status');
    try {
        const res = await fetch(dash.dataset.src, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        latest = await res.json();
        render(latest);
        status.classList.remove('error');
        status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (err) {
        status.classList.add('error');
        status.textContent = `Couldn't load metrics: ${err.message}`;
    } finally {
        // schedule the next poll only after this one settles, so slow
        // responses never stack up
        clearTimeout(timer);
        if (!document.hidden) timer = setTimeout(poll, POLL_MS);
    }
}

// no point polling a hidden tab; refresh immediately when it comes back
document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden) poll();
});

// charts are drawn at the container's pixel width, so redraw on resize
let resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (latest) {
            renderHistory(latest);
            renderCores(latest);
        }
    }, 150);
});

poll();
