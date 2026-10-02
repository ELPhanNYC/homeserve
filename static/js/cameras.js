// Each camera is an MJPEG stream shown in an <img>. Reconnect on failure, and
// drop the streams while the tab is hidden so the server can stop ffmpeg.

const RETRY_MS = 5000;

document.querySelectorAll('.camera').forEach((camera) => {
    const img = camera.querySelector('img');
    const status = camera.querySelector('.status');
    const text = status.querySelector('.status-text');
    let retryTimer = null;

    const showStatus = (message, isError) => {
        text.textContent = message;
        status.classList.toggle('error', isError);
        status.hidden = false;
    };

    camera.connect = () => {
        clearTimeout(retryTimer);
        showStatus('Connecting…', false);
        // cache-buster so the browser opens a fresh connection on retry
        img.src = `${camera.dataset.src}?t=${Date.now()}`;
    };

    camera.disconnect = () => {
        clearTimeout(retryTimer);
        img.removeAttribute('src');
    };

    // fires on the first frame of the multipart stream
    img.addEventListener('load', () => { status.hidden = true; });

    img.addEventListener('error', () => {
        if (!img.getAttribute('src')) return;  // we disconnected on purpose
        showStatus('Stream unavailable, retrying…', true);
        retryTimer = setTimeout(camera.connect, RETRY_MS);
    });

    img.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else camera.querySelector('.camera-frame').requestFullscreen?.();
    });

    camera.connect();
});

document.addEventListener('visibilitychange', () => {
    document.querySelectorAll('.camera').forEach((camera) => {
        if (document.hidden) camera.disconnect();
        else camera.connect();
    });
});
