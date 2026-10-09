import React from 'react';

const PRESET_PLACEHOLDERS = {
    brand: 'e.g. Boysen',
    color: 'e.g. Red',
    size: 'e.g. 1/2 in',
    size_variant: 'e.g. 1/2 in',
    material: 'e.g. PVC',
    model: 'e.g. ABC-100',
};

const getAttributePlaceholder = (definition) => {
    const key = String(definition.key || definition.name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return PRESET_PLACEHOLDERS[key] || `Enter ${definition.name}`;
};

const ProductAttributeFields = ({ definitions = [], values = {}, onChange }) => {
    if (definitions.length === 0) return null;
    const update = (key, value) => onChange({ ...values, [key]: value });
    return <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {definitions.map((definition) => {
            const common = {
                id: `product-attribute-${definition.key}`,
                value: values[definition.key] ?? '',
                required: Boolean(definition.required),
                onChange: (event) => update(definition.key, event.target.value),
                placeholder: getAttributePlaceholder(definition),
                className: 'w-full rounded-lg border border-gray-200 bg-white p-2 text-xs font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-400 dark:focus:ring-gray-500',
            };
            return <div key={definition.key}>
                <label htmlFor={common.id} className="mb-1 block text-[10px] font-semibold text-gray-500 dark:text-gray-400">{definition.name}{definition.required && <span className="ml-1 text-red-400">*</span>}</label>
                {definition.type === 'select' ? <select {...common}><option value="">Select {definition.name}...</option>{(definition.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
                    : definition.type === 'number_unit' ? <div className="flex items-stretch"><input {...common} type="number" step="any" className={`${common.className} rounded-r-none`}/><span className="flex shrink-0 items-center rounded-r-lg border border-l-0 border-gray-200 bg-slate-50 px-3 text-xs font-medium text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">{definition.unit}</span></div>
                    : (
                        <input {...common} type={definition.type === 'number' ? 'number' : 'text'} step={definition.type === 'number' ? 'any' : undefined}/>
                    )}
            </div>;
        })}
    </div>;
};

export default ProductAttributeFields;
