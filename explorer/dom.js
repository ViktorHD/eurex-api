// Small DOM helpers shared by the view modules.
export const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
};

export const icon = (name) => {
    const i = document.createElement('i');
    i.setAttribute('data-feather', name);
    i.setAttribute('aria-hidden', 'true');
    return i;
};

export const button = (label, { className = '', title = '', iconName = '', onClick = null } = {}) => {
    const b = el('button', className);
    b.type = 'button';
    if (title) b.title = title;
    if (iconName) b.appendChild(icon(iconName));
    b.append(iconName ? ` ${label}` : label);
    if (onClick) b.addEventListener('click', onClick);
    return b;
};

// "ProductISIN" -> "Product ISIN", "ContractSize" -> "Contract Size"
export const labelOf = (name) => String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

// "08:30:00" -> "08:30"
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

export const refreshIcons = () => { if (window.feather) window.feather.replace(); };
