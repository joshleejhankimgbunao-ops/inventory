import { useState } from 'react';
import { shouldConfirmExpiryTrackingDisable } from '../utils/expiryTrackingToggle';

const ProductExpiryFields = ({ value, onChange, disabled = false, minimumExpiryDate, mode = 'add', canManage = true }) => {
    const [disableConfirmationIdentity, setDisableConfirmationIdentity] = useState('');
    const productIdentity = String(value._id || value.id || value.code || value.sku || 'current-product');
    const showDisableConfirmation = disableConfirmationIdentity === productIdentity;
    const expiryFieldsVisible = value.expiryTrackingEnabled;
    const hasPositiveInitialStock = Number(value.stock || 0) > 0;
    const expiryIsTooEarly = expiryFieldsVisible && hasPositiveInitialStock && value.initialExpiryDate && minimumExpiryDate && value.initialExpiryDate < minimumExpiryDate;

    if (mode === 'edit') {
        const wasAlreadyTracked = value.originalExpiryTrackingEnabled === true;
        const guidance = expiryFieldsVisible
            ? (wasAlreadyTracked
                ? 'Current stock and batch records are preserved. Resolve active reservations and open Special Orders first. Historical sale allocations remain in the record.'
                : ((Number(value.stock || 0) > 0 || Number(value.reservedStock || 0) > 0)
                    ? 'Existing stock will not be assigned to batches automatically. Verify batches in Inventory → Verify Batches before using expiry-based stock selection.'
                    : 'No opening receipt or batch will be created. Expiry details are required when stock is received.'))
            : '';

        return (
            <div className="mt-3 space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-600">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Expiry Tracking</p>
                <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                    <input
                        type="checkbox"
                        checked={Boolean(value.expiryTrackingEnabled)}
                        onChange={(event) => {
                            if (shouldConfirmExpiryTrackingDisable({
                                mode,
                                wasAlreadyTracked,
                                enabled: value.expiryTrackingEnabled,
                                requestedEnabled: event.target.checked,
                            })) {
                                setDisableConfirmationIdentity(productIdentity);
                                return;
                            }
                            setDisableConfirmationIdentity('');
                            onChange({ ...value, expiryTrackingEnabled: event.target.checked });
                        }}
                        disabled={disabled || !canManage}
                        className="h-3.5 w-3.5 rounded border-gray-300 accent-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                    />
                    This product has expiry tracking
                </label>
                {guidance && <p className="text-[10px] leading-4 text-gray-500 dark:text-gray-400">{guidance}</p>}
                {showDisableConfirmation && expiryFieldsVisible && (
                    <div role="group" aria-label="Confirm turning off Expiry Tracking" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-600 dark:bg-slate-800/60">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Turn off Expiry Tracking?</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-slate-600 dark:text-slate-300">Expiry dates will no longer be required for new stock.</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-slate-600 dark:text-slate-300">Existing batch and sale history stays unchanged. A future Sale Void restores product stock only; verify batches before tracking resumes.</p>
                        <label className="mt-2 block text-[11px] font-medium text-slate-700 dark:text-slate-200">
                            Reason for correction <span className="text-red-600">*</span>
                            <textarea
                                name="expiryTrackingDisableReason"
                                data-validation-key="expiryTrackingDisableReason"
                                rows={2}
                                maxLength={500}
                                required
                                value={value.expiryTrackingDisableReason || ''}
                                onChange={(event) => onChange({ ...value, expiryTrackingDisableReason: event.target.value })}
                                placeholder="Why is Expiry Tracking being turned off?"
                                disabled={disabled || !canManage}
                                className="mt-1 block w-full resize-y rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-normal text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-400"
                            />
                        </label>
                        <div className="mt-2 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    onChange({ ...value, expiryTrackingDisableReason: '' });
                                    setDisableConfirmationIdentity('');
                                }}
                                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={disabled || !canManage || !String(value.expiryTrackingDisableReason || '').trim()}
                                onClick={() => {
                                    onChange({ ...value, expiryTrackingEnabled: false });
                                    setDisableConfirmationIdentity('');
                                }}
                                className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:text-slate-100 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800"
                            >
                                Turn Off Tracking
                            </button>
                        </div>
                    </div>
                )}
                {!canManage && <p className="text-[10px] leading-4 text-gray-500 dark:text-gray-400">Contact an administrator to change this setting.</p>}
            </div>
        );
    }

    return (
        <div className="mt-3 space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-600">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Expiry Tracking</p>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                <input
                    type="checkbox"
                    checked={value.expiryTrackingEnabled}
                    onChange={(event) => onChange({ ...value, expiryTrackingEnabled: event.target.checked })}
                    disabled={disabled}
                    className="h-3.5 w-3.5 rounded border-gray-300 accent-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                />
                This product has expiry tracking
            </label>
            {value.expiryTrackingEnabled && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    {Number(value.stock) > 0 ? 'Initial stock will be added as an expiry batch.' : 'No opening batch is created for zero stock.'}
                </p>
            )}
            {expiryFieldsVisible && hasPositiveInitialStock && (
                <div className="grid grid-cols-2 gap-2.5">
                    <label className="min-w-0 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                        Initial Stock Expiry Date <span className="text-red-400">*</span>
                        <input
                            type="date"
                            name="initialExpiryDate"
                            data-validation-key="initialExpiryDate"
                            value={value.initialExpiryDate}
                            onChange={(event) => onChange({ ...value, initialExpiryDate: event.target.value })}
                            min={minimumExpiryDate}
                            aria-invalid={Boolean(expiryIsTooEarly)}
                            aria-describedby={expiryIsTooEarly ? 'initial-stock-expiry-error' : undefined}
                            required={hasPositiveInitialStock}
                            disabled={disabled}
                            className="mt-1 block w-full min-w-0 rounded-lg border border-gray-200 bg-white p-2 text-xs font-medium text-gray-900 outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:ring-gray-500"
                        />
                        {expiryIsTooEarly && <span id="initial-stock-expiry-error" role="alert" className="mt-1 block font-normal text-red-600 dark:text-red-400">Expiry date must be later than today.</span>}
                    </label>
                    <label className="min-w-0 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                        Batch / Lot No. <span className="font-normal">(Optional)</span>
                        <input
                            type="text"
                            name="initialBatchLotNumber"
                            data-validation-key="initialBatchLotNumber"
                            value={value.initialBatchLotNumber}
                            onChange={(event) => onChange({ ...value, initialBatchLotNumber: event.target.value })}
                            placeholder="e.g. LOT-2026-001"
                            maxLength={100}
                            disabled={disabled}
                            className="mt-1 block w-full min-w-0 rounded-lg border border-gray-200 bg-white p-2 text-xs font-medium text-gray-900 outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:ring-gray-500"
                        />
                        <span className="mt-1 block text-[10px] font-normal leading-4 text-gray-500 dark:text-gray-400">Optional. A batch reference is generated when stock is recorded.</span>
                    </label>
                </div>
            )}
        </div>
    );
};

export default ProductExpiryFields;
