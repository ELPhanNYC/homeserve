// Generates passwords in the browser with crypto.getRandomValues; nothing is
// sent to the server.

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
const CHAR_LENGTH = 20;
const WORD_COUNT = 5;

// Uniform random integer in [0, max), using rejection sampling to avoid
// modulo bias.
function randomInt(max) {
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do {
        crypto.getRandomValues(buf);
    } while (buf[0] >= limit);
    return buf[0] % max;
}

function randomChars() {
    let out = '';
    for (let i = 0; i < CHAR_LENGTH; i++) out += CHARSET[randomInt(CHARSET.length)];
    return out;
}

// e.g. "maple7-river2-ocean9-candle4-tiger0"
function randomWords() {
    const words = [];
    for (let i = 0; i < WORD_COUNT; i++) {
        words.push(WORDLIST[randomInt(WORDLIST.length)] + randomInt(10));
    }
    return words.join('-');
}

const form = document.getElementById('gen-pass-form');
const field = document.getElementById('gen-pass-field');
const mode = document.getElementById('gen-pass-mode');
const copy = document.getElementById('gen-pass-copy');

function generate() {
    field.value = mode.value === 'words' ? randomWords() : randomChars();
    copy.textContent = 'Copy';
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    generate();
});
mode.addEventListener('change', generate);

copy.addEventListener('click', async () => {
    if (!field.value) return;
    try {
        await navigator.clipboard.writeText(field.value);
        copy.textContent = 'Copied!';
    } catch {
        // Clipboard API needs a secure context; fall back to selecting the text.
        field.select();
        copy.textContent = 'Press Ctrl+C';
    }
});

generate();
