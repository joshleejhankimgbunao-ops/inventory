import React, { useState } from 'react';
import { normalizeAttributeKey } from '../utils/productAttributes';

const TYPES = [
    ['text', 'Text'], ['number', 'Number'], ['select', 'Dropdown'], ['number_unit', 'Number + Unit'],
];
const PRESETS = [
    { name: 'Brand', type: 'text' }, { name: 'Color', type: 'text' },
    { name: 'Size / Variant', type: 'text' }, { name: 'Material', type: 'text' }, { name: 'Model', type: 'text' },
];
const EMPTY = { name: '', type: 'text', required: false, unit: '', optionsText: '' };

const typeLabel = (type) => TYPES.find(([key]) => key === type)?.[1] || 'Text';
const isConfigured = (attributes, name) => attributes.some((attribute) => (
    normalizeAttributeKey(attribute?.key || attribute?.name) === normalizeAttributeKey(name)
));

const CategoryAttributesEditor = ({ value = [], onChange, disabled = false }) => {
    const [editingIndex, setEditingIndex] = useState(null);
    const [draft, setDraft] = useState(EMPTY);
    const [error, setError] = useState('');
    const [isEditing, setIsEditing] = useState(false);

    const begin = (attribute = EMPTY, index = null) => {
        setEditingIndex(index);
        setDraft({ ...EMPTY, ...attribute, optionsText: (attribute.options || []).join(', ') });
        setError('');
        setIsEditing(true);
    };

    const closeEditor = () => {
        setEditingIndex(null);
        setDraft(EMPTY);
        setError('');
        setIsEditing(false);
    };

    const addPreset = (preset) => {
        const key = normalizeAttributeKey(preset.name);
        if (disabled || isConfigured(value, key)) return;
        onChange([...value, {
            name: preset.name,
            key,
            type: preset.type,
            required: false,
            unit: '',
            options: [],
            order: value.length,
        }]);
    };

    const save = () => {
        const name = draft.name.trim();
        const key = normalizeAttributeKey(name);
        const options = [...new Set(draft.optionsText.split(',').map((item) => item.trim()).filter(Boolean))];
        if (!name || !key) return setError('Attribute name is required.');
        if (value.some((item, index) => index !== editingIndex && normalizeAttributeKey(item.key || item.name) === key)) return setError('Attribute names must be unique.');
        if (draft.type === 'select' && options.length === 0) return setError('Add at least one dropdown option.');
        if (draft.type === 'number_unit' && !draft.unit.trim()) return setError('A unit is required.');
        const next = {
            name,
            key,
            type: draft.type,
            required: draft.required,
            unit: draft.type === 'number_unit' ? draft.unit.trim() : '',
            options: draft.type === 'select' ? options : [],
        };
        const rows = editingIndex === null ? [...value, next] : value.map((item, index) => index === editingIndex ? next : item);
        onChange(rows.map((item, order) => ({ ...item, order })));
        closeEditor();
    };

    const move = (index, direction) => {
        const target = index + direction;
        if (target < 0 || target >= value.length) return;
        const rows = [...value];
        [rows[index], rows[target]] = [rows[target], rows[index]];
        onChange(rows.map((item, order) => ({ ...item, order })));
    };

    const remove = (index) => {
        onChange(value.filter((_, row) => row !== index).map((item, order) => ({ ...item, order })));
        if (editingIndex === index) closeEditor();
    };

    return (
        <section className="space-y-3">
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Product Attributes</p>
                <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">Choose the details that distinguish products in this category.</p>
            </div>

            <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((preset) => {
                        const selected = isConfigured(value, preset.name);
                        return (
                            <button
                                key={preset.name}
                                type="button"
                                disabled={disabled || selected}
                                onClick={() => addPreset(preset)}
                                aria-pressed={selected}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-default ${
                                    selected
                                        ? 'border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-white'
                                }`}
                            >
                                {selected && <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="m5 12 4 4L19 6" /></svg>}
                                {preset.name}
                            </button>
                        );
                    })}
            </div>

            <button type="button" disabled={disabled} onClick={() => begin()} className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v14m7-7H5" /></svg>
                Add custom attribute
            </button>

            <div>
                <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                    {value.length === 0 && <p className="px-3 py-3 text-[10px] italic text-gray-400">No attributes added yet.</p>}
                    {value.map((attribute, index) => (
                        <div key={`${attribute.key || attribute.name}-${index}`} className="flex items-center gap-2 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">{attribute.name}</p>
                                <p className="mt-0.5 text-[10px] text-gray-400">{typeLabel(attribute.type)} · {attribute.required ? 'Required' : 'Optional'}{attribute.unit ? ` · ${attribute.unit}` : ''}{attribute.type === 'select' ? ` · ${(attribute.options || []).length} options` : ''}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <button type="button" disabled={disabled || index === 0} aria-label={`Move ${attribute.name} up`} onClick={() => move(index, -1)} className="rounded p-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-25 dark:hover:bg-gray-700 dark:hover:text-gray-200">↑</button>
                                <button type="button" disabled={disabled || index === value.length - 1} aria-label={`Move ${attribute.name} down`} onClick={() => move(index, 1)} className="rounded p-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-25 dark:hover:bg-gray-700 dark:hover:text-gray-200">↓</button>
                                <button type="button" disabled={disabled} onClick={() => begin(attribute, index)} className="rounded px-1.5 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-gray-700 dark:hover:text-white">Edit</button>
                                <button type="button" disabled={disabled} onClick={() => remove(index)} className="rounded px-1.5 py-1 text-[10px] font-medium text-rose-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 dark:hover:bg-rose-900/20">Remove</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {isEditing && (
                <div className="space-y-2 rounded-lg border border-gray-200 bg-slate-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                    <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{editingIndex === null ? 'Custom attribute' : `Edit ${value[editingIndex]?.name || 'attribute'}`}</p>
                    <div className="grid grid-cols-2 gap-2">
                        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Attribute name" className="rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
                        <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })} className="rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white">{TYPES.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select>
                    </div>
                    {draft.type === 'select' && <input value={draft.optionsText} onChange={(event) => setDraft({ ...draft, optionsText: event.target.value })} placeholder="Options, separated by commas" className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />}
                    {draft.type === 'number_unit' && <input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} placeholder="Measurement Unit (e.g. kg, mm)" className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />}
                    <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={draft.required} onChange={(event) => setDraft({ ...draft, required: event.target.checked })} />Required</label>
                        <div className="flex gap-2"><button type="button" onClick={closeEditor} className="px-2 py-1 text-xs text-gray-500">Cancel</button><button type="button" onClick={save} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900">Save</button></div>
                    </div>
                    {error && <p className="text-[10px] text-red-500">{error}</p>}
                </div>
            )}
        </section>
    );
};

export default CategoryAttributesEditor;
