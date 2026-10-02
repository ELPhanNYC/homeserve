// Shared helpers for the tool pages: busy spinner, downloads, error messages.

// Shows the spinner + elapsed time under `form` and disables its submit button.
// Returns a function that ends the busy state; pass it an error message to show
// that instead of clearing the status line.
function startBusy(form, label) {
    const status = form.parentElement.querySelector('.status');
    const text = status.querySelector('.status-text');
    const submit = form.querySelector('[type="submit"]');
    const started = Date.now();

    const render = () => {
        const secs = Math.floor((Date.now() - started) / 1000);
        text.textContent = `${label}… ${secs}s`;
    };

    status.classList.remove('error');
    status.hidden = false;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    render();
    const timer = setInterval(render, 1000);

    return (errorMessage) => {
        clearInterval(timer);
        submit.disabled = false;
        form.removeAttribute('aria-busy');
        if (errorMessage) {
            status.classList.add('error');
            text.textContent = errorMessage;
        } else {
            status.hidden = true;
        }
    };
}

// Pulls a readable message out of a failed response (Flask's abort() pages
// put the reason in the first <p>).
async function errorMessage(res) {
    const body = await res.text();
    const p = new DOMParser().parseFromString(body, 'text/html').querySelector('p');
    return (p && p.textContent.trim()) || `Request failed (${res.status})`;
}

// Filename from Content-Disposition, preferring the UTF-8 `filename*=` form
// so titles with accents/emoji survive.
function filenameFrom(res, fallback) {
    const disposition = res.headers.get('Content-Disposition') || '';
    const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8) return decodeURIComponent(utf8[1]);
    const plain = disposition.match(/filename="?([^";]+)"?/i);
    return plain ? plain[1] : fallback;
}

async function saveResponse(res, fallbackName) {
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filenameFrom(res, fallbackName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
}

// Wires a form to POST via fetch with a spinner, then save the returned file.
// `buildRequest(form)` returns the fetch options (method is always POST).
function bindDownloadForm(form, { url, label, fallbackName, buildRequest }) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const request = buildRequest(form);
        if (!request) return;

        const done = startBusy(form, label);
        try {
            const res = await fetch(url, { method: 'POST', ...request });
            if (!res.ok) throw new Error(await errorMessage(res));
            await saveResponse(res, fallbackName);
            form.reset();
            done();
        } catch (err) {
            done(err.message || 'Something went wrong.');
        }
    });
}
