const COLOR_SWATCHES = {
    beige: '#E6D5B8',
    black: '#111827',
    blue: '#2563EB',
    brown: '#92400E',
    burgundy: '#800020',
    gray: '#808080',
    grey: '#808080',
    green: '#16A34A',
    navy: '#2B5797',
    orange: '#EA580C',
    pink: '#EC4899',
    purple: '#9333EA',
    red: '#D10000',
    silver: '#CBD5E1',
    white: '#FFFFFF',
    yellow: '#EAB308',
};

const NEUTRAL_COLOR = '#94A3B8';

const normalizeColorKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');

const resolveColorPart = (value) => {
    const colorName = String(value || '').trim();
    const key = normalizeColorKey(colorName);
    const hex = COLOR_SWATCHES[key];
    return hex ? { name: colorName, hex } : null;
};

export const getColorSwatch = (value) => {
    const name = String(value || '').trim();
    if (!name) return null;
    if (/^#[0-9a-f]{6}$/i.test(name)) return { name, hex: name, colors: [{ name, hex: name }] };

    const key = normalizeColorKey(name);
    const segments = key.split(/\s*(?:\band\b|[-_/&+,])\s*/i).filter(Boolean);
    const colors = segments.map((segment) => resolveColorPart(segment) || { name: segment, hex: NEUTRAL_COLOR });

    if (colors.length > 0) {
        return { name, hex: colors[0].hex, colors };
    }

    return { name, hex: NEUTRAL_COLOR, colors: [{ name, hex: NEUTRAL_COLOR }] };
};
