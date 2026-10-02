bindDownloadForm(document.getElementById('format-image'), {
    url: '/format-image',
    label: 'Converting',
    fallbackName: 'images.zip',
    buildRequest: (form) => ({ body: new FormData(form) }),
});
