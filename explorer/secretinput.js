// API keys are shown masked but are plain text inputs: with type="password" Chrome treats the page as a login form
// and offers to save a password (e.g. after typing a product and switching views). A text input masked with CSS
// (-webkit-text-security) gets no such offer. Browsers without that CSS property keep type="password".
export const supportsTextMask = () => typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('-webkit-text-security', 'disc');

const attrs = {
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    'data-lpignore': 'true',   // LastPass
    'data-1p-ignore': 'true',  // 1Password
    'data-form-type': 'other'  // Dashlane
};

export function hardenSecretInput(input) {
    Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));
    input.classList.add('secret-input');
    input.type = supportsTextMask() ? 'text' : 'password';
    return input;
}

export const isRevealed = (input) => (supportsTextMask() ? input.classList.contains('revealed') : input.type !== 'password');

export function setRevealed(input, on) {
    if (supportsTextMask()) input.classList.toggle('revealed', on);
    else input.type = on ? 'text' : 'password';
}
