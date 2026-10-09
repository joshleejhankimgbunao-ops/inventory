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
    const save = () => {
        const name = draft.name.trim();
        const key = normalizeAttributeKey(name);
        const options = [...new Set(draft.optionsText.split(',').map((item) => item.trim()).filter(Boolean))];
        if (!name || !key) return setError('Attribute name is required.');
        if (value.some((item, index) => index !== editingIndex && normalizeAttributeKey(item.name) === key)) return setError('Attribute names must be unique.');
        if (draft.type === 'select' && options.length === 0) return setError('Add at least one dropdown option.');
        if (draft.type === 'number_unit' && !draft.unit.trim()) return setError('A unit is required.');
        const next = { name, key, type: draft.type, required: draft.required, unit: draft.type === 'number_unit' ? draft.unit.trim() : '', options: draft.type === 'select' ? options : [] };
        const rows = editingIndex === null ? [...value, next] : value.map((item, index) => index === editingIndex ? next : item);
        onChange(rows.map((item, order) => ({ ...item, order })));
        setEditingIndex(null); setDraft(EMPTY); setError(''); setIsEditing(false);
    };
    return <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Product Attributes</p><p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">Define the information used for products under this category.</p></div>
            <button type="button" disabled={disabled} onClick={() => begin()} className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">+ Add Attribute</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => <button key={preset.name} type="button" disabled={disabled || value.some((item) => item.key === normalizeAttributeKey(preset.name))} onClick={() => begin(preset)} className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">{preset.name}</button>)}
        </div>
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            {value.length === 0 && <p className="px-3 py-3 text-[10px] italic text-gray-400">No product attributes configured.</p>}
            {value.map((attribute, index) => <div key={`${attribute.key}-${index}`} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">{attribute.name}</p><p className="text-[10px] text-gray-400">{TYPES.find(([type]) => type === attribute.type)?.[1] || 'Text'} · {attribute.required ? 'Required' : 'Optional'}{attribute.unit ? ` · ${attribute.unit}` : ''}{attribute.type === 'select' ? ` · ${(attribute.options || []).length} options` : ''}</p></div>
                <button type="button" disabled={index === 0} aria-label={`Move ${attribute.name} up`} onClick={() => { const rows = [...value]; [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; onChange(rows.map((item, order) => ({ ...item, order }))); }} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-25 dark:hover:text-gray-200">↑</button>
                <button type="button" disabled={index === value.length - 1} aria-label={`Move ${attribute.name} down`} onClick={() => { const rows = [...value]; [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]]; onChange(rows.map((item, order) => ({ ...item, order }))); }} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-25 dark:hover:text-gray-200">↓</button>
                <button type="button" onClick={() => begin(attribute, index)} className="text-[10px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">Edit</button>
                <button type="button" onClick={() => onChange(value.filter((_, row) => row !== index).map((item, order) => ({ ...item, order })))} className="text-[10px] font-medium text-rose-500 hover:text-rose-700">Delete</button>
            </div>)}
        </div>
        {isEditing && <div className="space-y-2 rounded-lg border border-gray-200 bg-slate-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="grid grid-cols-2 gap-2"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Attribute name" className="rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white"/><select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className="rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white">{TYPES.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></div>
            {draft.type === 'select' && <input value={draft.optionsText} onChange={(e) => setDraft({ ...draft, optionsText: e.target.value })} placeholder="Options, separated by commas" className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white"/>}
            {draft.type === 'number_unit' && <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="Unit (e.g. kg, mm)" className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white"/>}
            <div className="flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })}/>Required</label><div className="flex gap-2"><button type="button" onClick={() => { setEditingIndex(null); setDraft(EMPTY); setError(''); setIsEditing(false); }} className="px-2 py-1 text-xs text-gray-500">Cancel</button><button type="button" onClick={save} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900">Save</button></div></div>
            {error && <p className="text-[10px] text-red-500">{error}</p>}
        </div>}
    </div>;
};

export default CategoryAttributesEditor;
