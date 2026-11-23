const manilaDateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});

export const getManilaBusinessDate = (now = new Date()) => {
    const parts = Object.fromEntries(manilaDateFormatter.formatToParts(now).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
};

export const getTomorrowManilaDate = (now = new Date()) => {
    const today = getManilaBusinessDate(now);
    return new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
};

export const isValidExpiryDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const isFutureExpiryDate = (value, now = new Date()) => {
    return isValidExpiryDate(value) && value > getManilaBusinessDate(now);
};

export const formatExpiryDateLabel = (value) => {
    const dateValue = String(value || '').trim();
    const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return dateValue || '—';

    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() !== Number(year)
        || date.getUTCMonth() !== Number(month) - 1
        || date.getUTCDate() !== Number(day)) {
        return dateValue;
    }

    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(date);
};
