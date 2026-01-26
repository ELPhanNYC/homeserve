document.getElementById('single-convert').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const url = form.url.value;

    try {
        const res = await fetch('/audio-download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        if (!res.ok) throw new Error('Download failed');

        const disposition = res.headers.get('Content-Disposition');
        console.log(disposition);
        let filename = 'audio.mp3'; // default fallback
        if (disposition && disposition.includes('filename=')) {
            filename = disposition
                .split('filename=')[1]
                .split(';')[0]
                .replace(/"/g, '');
        }

        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename; // use the returned filename
        document.body.appendChild(link);
        link.click();
        link.remove();

        form.reset();
        
    } catch (err) {
        alert(err.message);
    }
});

document.getElementById('bulk-convert').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fileInput = form.file.files[0];

    if (!fileInput) {
        alert("Please select a .txt file");
        return;
    }

    const formData = new FormData();
    formData.append("file", fileInput);

    try {
        const res = await fetch('/audio-download-bulk', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error('Download failed');

        // Get filename from Content-Disposition header
        const disposition = res.headers.get('Content-Disposition');
        let filename = 'audios.zip';
        if (disposition && disposition.includes('filename=')) {
            filename = disposition.split('filename=')[1].split(';')[0].replace(/"/g, '');
        }

        const blob = await res.blob();
        const link = document.createElement('a');
        const blobUrl = URL.createObjectURL(blob);
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);

        form.reset();

    } catch (err) {
        alert(err.message);
    }
});
