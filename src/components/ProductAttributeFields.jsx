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

const normalizedAttributeKey = (definition) => String(definition.key || definition.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const getDisplayName = (definition) => {
    // Keep the stored category definition intact. This is a narrowly-scoped
    // clarification for the common numeric specification named Weight Pack.
    if (definition.type === 'number_unit' && normalizedAttributeKey(definition) === 'weight_pack') {
        return 'Weight per Pack';
    }
    return definition.name;
};

const isWeightPerPack = (definition) => (
    definition.type === 'number_unit' && normalizedAttributeKey(definition) === 'weight_pack'
);

const ProductAttributeFields = ({ definitions = [], values = {}, onChange, renderSupplementaryField }) => {
    if (definitions.length === 0) return null;
    const update = (key, value) => onChange({ ...values, [key]: value });
    const inputClassName = 'w-full rounded-lg border border-gray-200 bg-white p-2 text-xs font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-400 dark:focus:ring-gray-500';
    const supplementaryFieldIndex = typeof renderSupplementaryField === 'function'
        ? definitions.findIndex((definition) => definition.type === 'number_unit')
        : -1;

    const renderAttributeField = (definition) => {
        const displayName = getDisplayName(definition);
        const common = {
            id: `product-attribute-${definition.key}`,
            value: values[definition.key] ?? '',
            required: Boolean(definition.required),
            onChange: (event) => update(definition.key, event.target.value),
            placeholder: getAttributePlaceholder(definition),
        };

        return <div key={definition.key}>
            <label htmlFor={common.id} className="mb-1 block text-[10px] font-semibold text-gray-500 dark:text-gray-400">{displayName}{definition.required && <span className="ml-1 text-red-400">*</span>}</label>
            {definition.type === 'select' ? <select {...common} className={inputClassName}><option value="">Select {displayName}...</option>{(definition.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
                : definition.type === 'number_unit' ? <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:focus-within:ring-gray-500"><input {...common} type="number" step="any" className="min-w-0 flex-1 border-0 bg-transparent p-2 text-xs font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:ring-0 dark:text-white dark:placeholder:text-gray-400"/><span className="flex shrink-0 items-center border-l border-gray-200 bg-slate-50 px-3 text-xs font-medium text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">{definition.unit}</span></div>
                : (
                    <input {...common} type={definition.type === 'number' ? 'number' : 'text'} step={definition.type === 'number' ? 'any' : undefined} className={inputClassName}/>
                )}
            {isWeightPerPack(definition) && <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">Weight of one pack, not the selling unit.</p>}
        </div>;
    };

    return <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {definitions.map((definition, index) => {
            const supplementaryField = index === supplementaryFieldIndex
                ? renderSupplementaryField(definition)
                : null;

            if (supplementaryField) {
                return <div key={definition.key} className="grid grid-cols-1 gap-2.5 sm:col-span-2 sm:grid-cols-2">
                    {renderAttributeField(definition)}
                    {supplementaryField}
                </div>;
            }

            return renderAttributeField(definition);
        })}
    </div>;
};

export default ProductAttributeFields;
