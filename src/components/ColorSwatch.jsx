import React from 'react';
import { getColorSwatch } from '../utils/colorSwatches';

const ColorSwatch = ({ value, className = '' }) => {
    const swatch = getColorSwatch(value);
    if (!swatch) return <span className={`text-xs text-slate-400 ${className}`.trim()}>—</span>;

    return (
        <span className={`inline-flex min-w-0 items-center justify-center gap-1.5 ${className}`.trim()} title={swatch.name}>
            <span
                className="inline-flex h-5 w-5 shrink-0 overflow-hidden rounded-full border border-slate-300 shadow-sm"
                aria-hidden="true"
            >
                {swatch.colors.map((color, index) => (
                    <span key={`${color.hex}-${index}`} className="h-full min-w-0 flex-1" style={{ backgroundColor: color.hex }} />
                ))}
            </span>
            <span className="max-w-28 truncate text-xs text-slate-700 dark:text-slate-200">{swatch.name}</span>
        </span>
    );
};

export default ColorSwatch;
