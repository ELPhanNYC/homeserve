bindDownloadForm(document.getElementById('single-convert'), {
    url: '/audio-download',
    label: 'Converting',
    fallbackName: 'audio.mp3',
    buildRequest: (form) => ({
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.url.value.trim() }),
    }),
});

bindDownloadForm(document.getElementById('bulk-convert'), {
    url: '/audio-download-bulk',
    label: 'Converting all links',
    fallbackName: 'audios.zip',
    buildRequest: (form) => {
        const formData = new FormData();
        formData.append('file', form.file.files[0]);
        return { body: formData };
    },
});
