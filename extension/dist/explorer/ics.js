// iCalendar (.ics) files for expirations, holidays and announced API changes.

const pad = (n) => String(n).padStart(2, '0');

const escapeText = (s) => String(s ?? '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 octets are folded: CRLF + one space
function fold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = '';
    let size = 0;
    for (const ch of line) {
        const w = enc.encode(ch).length;
        const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
        if (size + w > limit) { out.push(cur); cur = ''; size = 0; }
        cur += ch;
        size += w;
    }
    out.push(cur);
    return out.join('\r\n ');
}

const compactDate = (iso) => String(iso).slice(0, 10).replace(/-/g, '');

function nextDay(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

const stamp = (now) => `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

/**
 * events: [{ uid, date: 'YYYY-MM-DD', summary, description? }] (all-day events); entries without a valid date are skipped.
 */
export function buildIcs(events, { name = 'Eurex', now = new Date() } = {}) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Eurex API Explorer//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeText(name)}`
    ];
    for (const e of events) {
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(e.date || ''))) continue;
        lines.push(
            'BEGIN:VEVENT',
            `UID:${escapeText(e.uid || `${e.date}-${e.summary}`).replace(/\s+/g, '-')}@eurex-api-explorer`,
            `DTSTAMP:${stamp(now)}`,
            `DTSTART;VALUE=DATE:${compactDate(e.date)}`,
            `DTEND;VALUE=DATE:${nextDay(e.date)}`,
            `SUMMARY:${escapeText(e.summary)}`
        );
        if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
        lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
}
