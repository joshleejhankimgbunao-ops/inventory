import React, { useState } from 'react';

const COMMON_UNITS = ['pcs', 'box', 'pack', 'kg', 'meter', 'roll'];

const CategorySellingUnitsEditor = ({
    units = [],
    customUnit = '',
    onCustomUnitChange,
    onAddUnit,
    onRemoveUnit,
    disabled = false,
}) => {
    const [isCustomUnitOpen, setIsCustomUnitOpen] = useState(false);
    const selected = (unit) => units.some((item) => String(item).toLowerCase() === unit.toLowerCase());

    const addCustomUnit = () => {
        if (!String(customUnit || '').trim()) return;
        onAddUnit(customUnit);
    };

    return (
        <section className="space-y-2.5">
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Selling Units</p>
                <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">Choose the units used to sell and track inventory for products in this category.</p>
            </div>

            <div className="flex flex-wrap gap-1.5">
                    {COMMON_UNITS.map((unit) => {
                        const isSelected = selected(unit);
                        return (
                            <button
                                key={unit}
                                type="button"
                                disabled={disabled || isSelected}
                                onClick={() => onAddUnit(unit)}
                                aria-pressed={isSelected}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-default ${
                                    isSelected
                                        ? 'border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-white'
                                }`}
                            >
                                {isSelected && (
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="m5 12 4 4L19 6" />
                                    </svg>
                                )}
                                {unit}
                            </button>
                        );
                    })}
            </div>

            {!isCustomUnitOpen ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setIsCustomUnitOpen(true)}
                    className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
                >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v14m7-7H5" /></svg>
                    Add custom unit
                </button>
            ) : (
                <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor="custom-selling-unit">Custom selling unit</label>
                    <input
                        id="custom-selling-unit"
                        type="text"
                        value={customUnit}
                        onChange={(event) => onCustomUnitChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                addCustomUnit();
                            }
                        }}
                        placeholder="e.g. bundle"
                        disabled={disabled}
                        className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-2 text-xs font-medium text-gray-900 outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:ring-gray-500"
                    />
                    <button type="button" disabled={disabled} onClick={addCustomUnit} className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                        Add
                    </button>
                    <button type="button" disabled={disabled} onClick={() => setIsCustomUnitOpen(false)} className="rounded-lg px-2 py-2 text-[10px] font-medium text-gray-500 hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-100">
                        Cancel
                    </button>
                </div>
            )}

            <div className="flex min-h-[42px] flex-wrap gap-1.5 rounded-lg border border-dashed border-gray-200 bg-slate-50/50 p-2.5 dark:border-gray-700 dark:bg-gray-900/30">
                {units.length === 0 ? (
                    <span className="text-[10px] font-medium italic text-gray-400">No selling units selected yet.</span>
                ) : units.map((unit) => (
                    <span key={unit} className="inline-flex items-center gap-1 rounded-md border border-gray-100 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                        {unit}
                        <button type="button" disabled={disabled} onClick={() => onRemoveUnit(unit)} aria-label={`Remove ${unit}`} className="rounded p-0.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-900/30">
                            <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="m6 6 12 12M18 6 6 18" /></svg>
                        </button>
                    </span>
                ))}
            </div>
        </section>
    );
};

export default CategorySellingUnitsEditor;
