import React, { useState } from 'react';
import ProductAttributeFields from './ProductAttributeFields';
import { validateAttributeValues } from '../utils/productAttributes';
import { buildCategoryAttributeMigration } from '../utils/productCategoryChange';

const AttributeList = ({ title, rows, emptyText }) => (
    <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{title}</p>
        {rows.length ? (
            <ul className="mt-1.5 space-y-1 text-xs text-slate-700 dark:text-slate-200">
                {rows.map(({ definition, value }) => (
                    <li key={definition.key} className="flex items-start justify-between gap-3">
                        <span>{definition.name}</span>
                        {value !== undefined && value !== '' && <span className="text-right font-medium text-slate-950 dark:text-white">{String(value)}</span>}
                    </li>
                ))}
            </ul>
        ) : <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">{emptyText}</p>}
    </div>
);

const VariantCategoryChangeModal = ({ product, categories, onCancel, onApply }) => {
    const currentCategory = categories.find((category) => category.name === product.category) || { name: product.category };
    const targets = categories.filter((category) => category.isActive !== false && category.name !== product.category);
    const [selection, setSelection] = useState(() => {
        const target = targets[0] || null;
        const initialMigration = target ? buildCategoryAttributeMigration({ product, currentCategory, targetCategory: target }) : null;
        return { name: target?.name || '', values: initialMigration?.targetValues || {} };
    });
    const [error, setError] = useState('');
    const [isConfirming, setIsConfirming] = useState(false);
    const targetCategory = targets.find((category) => category.name === selection.name) || null;
    const migration = targetCategory
        ? buildCategoryAttributeMigration({ product, currentCategory, targetCategory })
        : null;
    const targetName = selection.name;
    const targetValues = selection.values;

    if (!targetCategory || !migration) return null;

    const review = () => {
        const validationError = validateAttributeValues(migration.targetDefinitions, targetValues);
        if (validationError) {
            setError(validationError);
            return;
        }
        setError('');
        setIsConfirming(true);
    };

    const addedValues = migration.targetDefinitions
        .filter((definition) => String(targetValues[definition.key] ?? '').trim())
        .filter((definition) => String(targetValues[definition.key] ?? '').trim() !== String(migration.currentValues[definition.key] ?? '').trim())
        .map((definition) => ({ definition, value: targetValues[definition.key] }));

    return (
        <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="change-category-title" className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                <header className="border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
                    <h3 id="change-category-title" className="text-base font-semibold text-slate-950 dark:text-white">Change Category</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Move {product.code} only. No sibling variants will change.</p>
                </header>

                {!isConfirming ? (
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Current Category</p>
                                <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">{product.category}</p>
                            </div>
                            <div>
                                <label htmlFor="variant-target-category" className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Target Category</label>
                                <select id="variant-target-category" value={targetName} onChange={(event) => {
                                    const nextTarget = targets.find((category) => category.name === event.target.value);
                                    const nextMigration = buildCategoryAttributeMigration({ product, currentCategory, targetCategory: nextTarget });
                                    setSelection({ name: nextTarget.name, values: nextMigration.targetValues });
                                    setError('');
                                    setIsConfirming(false);
                                }} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-900 outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-white">
                                    {targets.map((category) => <option key={category.name} value={category.name}>{category.name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800">
                            <AttributeList title="Compatible" rows={migration.compatible} emptyText="No compatible attributes." />
                            <AttributeList title="Will be removed" rows={migration.removed} emptyText="No populated attributes removed." />
                            <AttributeList title="New required" rows={migration.required.map((definition) => ({ definition }))} emptyText="No new required attributes." />
                            <AttributeList title="New optional" rows={migration.optional.map((definition) => ({ definition }))} emptyText="No new optional attributes." />
                        </div>

                        {migration.targetDefinitions.length > 0 && (
                            <div>
                                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Target Attributes</p>
                                <ProductAttributeFields definitions={migration.targetDefinitions} values={targetValues} onChange={(values) => setSelection((current) => ({ ...current, values }))} />
                            </div>
                        )}
                        {error && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>}
                    </div>
                ) : (
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                        <div>
                            <h4 className="text-sm font-semibold text-slate-950 dark:text-white">Move this variant to {targetName}?</h4>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">This affects {product.code} only.</p>
                        </div>
                        <AttributeList title="Removed" rows={migration.removed} emptyText="No populated attributes will be removed." />
                        <AttributeList title="New" rows={addedValues} emptyText="No new attribute values." />
                        <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300">SKU, price, stock, supplier, image, and status will remain unchanged.</p>
                    </div>
                )}

                <footer className="flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-800">
                    <button type="button" onClick={isConfirming ? () => setIsConfirming(false) : onCancel} className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">{isConfirming ? 'Back' : 'Cancel'}</button>
                    <button type="button" onClick={isConfirming ? () => onApply({ category: targetName, attributes: targetValues, definitions: migration.targetDefinitions }) : review} className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white">{isConfirming ? 'Confirm Change' : 'Review Change'}</button>
                </footer>
            </div>
        </div>
    );
};

export default VariantCategoryChangeModal;
