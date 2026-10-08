import { useEffect, useRef, useState } from 'react';
import { updateSaleTransactionReferenceApi } from '../services/inventoryApi';
import {
  getTransactionReferenceNumberError,
  hasUsableTransactionReference,
  normalizeTransactionReferenceInput,
  TRANSACTION_REFERENCE_REQUIRED_MESSAGE,
} from '../utils/transactionReference';

const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;

const TransactionReferenceModal = ({
  saleId,
  initialReference = null,
  onSkip,
  onSaved,
  onSave,
  saveLabel = 'Save & Continue',
  failureMessage = 'Transaction completed, but the reference details could not be saved.',
  requiredFlow = false,
  referenceNumberOnly = false,
}) => {
  const [referenceNumber, setReferenceNumber] = useState(initialReference?.referenceNumber || '');
  const [documentFile, setDocumentFile] = useState(null);
  const [error, setError] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const canDismiss = !requiredFlow && typeof onSkip === 'function';
  const hasReference = hasUsableTransactionReference({
    referenceNumber,
    documentFile,
    existingReference: initialReference,
    referenceNumberOnly,
  });

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && canDismiss && !savingRef.current) onSkip();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canDismiss, onSkip]);

  const selectFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Choose a JPG, JPEG, or PNG image.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE) {
      setError('Supporting Document must be 5 MB or smaller.');
      event.target.value = '';
      return;
    }
    setError(getTransactionReferenceNumberError(referenceNumber));
    setSaveFailed(false);
    setDocumentFile(file);
  };

  const save = async (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    const trimmed = referenceNumber.trim();
    const referenceError = getTransactionReferenceNumberError(referenceNumber);
    if (referenceError) {
      setError(referenceError);
      return;
    }
    if (!hasReference) {
      setError(referenceNumberOnly ? 'Provide a Reference No.' : TRANSACTION_REFERENCE_REQUIRED_MESSAGE);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const updated = onSave
        ? await onSave({ referenceNumber: trimmed, documentFile })
        : await updateSaleTransactionReferenceApi(saleId, { referenceNumber: trimmed, documentFile });
      onSaved(updated);
    } catch (saveError) {
      setSaveFailed(true);
      setError(`${failureMessage} ${saveError.message || ''}`.trim());
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && canDismiss && !savingRef.current) onSkip(); }}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-label="Transaction Reference" className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] dark:border-slate-700/80 dark:bg-[#24262a] dark:shadow-[0_20px_50px_-24px_rgba(0,0,0,0.6)]">
        <div className="flex items-start justify-between border-b border-slate-200/70 px-5 py-4 dark:border-slate-700/70">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Transaction Reference</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{referenceNumberOnly ? 'A Reference No. is required before this offline sale can be saved.' : 'Provide at least one reference method for this transaction.'}</p>
          </div>
          {canDismiss && <button type="button" onClick={onSkip} disabled={saving} aria-label="Close transaction reference" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-lg text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 disabled:opacity-50 dark:hover:bg-slate-700/70 dark:hover:text-slate-100">&times;</button>}
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <label htmlFor="transaction-reference-number" className="block text-xs font-medium text-slate-700 dark:text-slate-200">Reference No. <span className="font-normal text-slate-400">{referenceNumberOnly ? 'Required' : 'One method required'}</span></label>
            <input id="transaction-reference-number" type="text" inputMode="numeric" pattern="[0-9]*" value={referenceNumber} onChange={(event) => { const nextValue = normalizeTransactionReferenceInput(event.target.value); setReferenceNumber(nextValue); setError(''); setSaveFailed(false); }} aria-invalid={Boolean(getTransactionReferenceNumberError(referenceNumber))} disabled={saving} autoFocus className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-300/40 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-500/25 dark:disabled:bg-[#292c30]" />
          </div>
          {!referenceNumberOnly && <div>
            <label htmlFor="transaction-supporting-document" className="block text-xs font-medium text-slate-700 dark:text-slate-200">Supporting Document <span className="font-normal text-slate-400">One method required</span></label>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Upload a JPG or PNG related to this transaction.</p>
            <input id="transaction-supporting-document" type="file" accept="image/jpeg,image/png" onChange={selectFile} disabled={saving} className="mt-2 block w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-1 text-xs text-slate-500 outline-none transition-colors file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-700 hover:border-slate-300 hover:file:bg-slate-200/80 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300/40 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-400 dark:file:bg-[#373a40] dark:file:text-slate-200 dark:hover:border-slate-500 dark:hover:file:bg-[#3d4147] dark:focus-visible:border-slate-500 dark:focus-visible:ring-slate-500/25 dark:disabled:bg-[#292c30]" />
            {(documentFile || initialReference?.supportingDocument) && <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{documentFile?.name || initialReference.supportingDocument.originalName}</p>}
          </div>}
          {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200/70 px-5 py-3 dark:border-slate-700/70">
          {canDismiss && <button type="button" onClick={onSkip} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 disabled:opacity-50 dark:border-slate-600 dark:bg-[#2d3035] dark:text-slate-200 dark:hover:bg-[#373a40]">Cancel</button>}
          <button type="submit" disabled={saving || !hasReference || Boolean(error && !saveFailed)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:focus-visible:ring-slate-300/40 dark:focus-visible:ring-offset-[#24262a]">{saving ? 'Saving…' : saveFailed ? 'Try Again' : saveLabel}</button>
        </div>
      </form>
    </div>
  );
};

export default TransactionReferenceModal;
