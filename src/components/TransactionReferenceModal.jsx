import { useEffect, useRef, useState } from 'react';
import { updateSaleTransactionReferenceApi } from '../services/inventoryApi';
import {
  getTransactionReferenceNumberError,
  hasUsableTransactionReference,
  normalizeTransactionReferenceInput,
} from '../utils/transactionReference';

const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;

const TransactionReferenceModal = ({
  saleId,
  initialReference = null,
  onSkip,
  onSaved,
  onSave,
  saveLabel = 'Save & Continue',
  failureMessage = 'Transaction completed, but the reference was not saved. Try again or correct it later.',
  requiredFlow = false,
  referenceNumberOnly = false,
}) => {
  const [referenceNumber, setReferenceNumber] = useState(initialReference?.referenceNumber || '');
  const [documentFile, setDocumentFile] = useState(null);
  const [error, setError] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const fileInputRef = useRef(null);
  const canDismiss = !requiredFlow && typeof onSkip === 'function';
  const referenceNumberError = getTransactionReferenceNumberError(referenceNumber);
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

  const clearSelectedFile = () => {
    setDocumentFile(null);
    setSaveFailed(false);
    setError(referenceNumberError);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
      setError(referenceNumberOnly ? 'Provide a Reference No.' : 'Enter a reference number or upload a document.');
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
    } catch {
      setSaveFailed(true);
      setError(failureMessage);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="app-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && canDismiss && !savingRef.current) onSkip(); }}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-label="Transaction Reference" className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] dark:border-slate-700/80 dark:bg-[#24262a] dark:shadow-[0_20px_50px_-24px_rgba(0,0,0,0.6)]">
        <div className="flex items-start justify-between border-b border-slate-200/70 px-5 py-4 dark:border-slate-700/70">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Transaction Reference</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{referenceNumberOnly ? 'A Reference No. is required before this offline sale can be saved.' : 'Enter a reference number or upload a document.'}</p>
          </div>
          {canDismiss && <button type="button" onClick={onSkip} disabled={saving} aria-label="Close transaction reference" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-lg text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 disabled:opacity-50 dark:hover:bg-slate-700/70 dark:hover:text-slate-100">&times;</button>}
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <label htmlFor="transaction-reference-number" className="block text-xs font-medium text-slate-700 dark:text-slate-200">Reference No. {referenceNumberOnly && <span className="font-normal text-slate-400">Required</span>}</label>
            <input id="transaction-reference-number" type="text" inputMode="numeric" pattern="[0-9]*" value={referenceNumber} onChange={(event) => { const nextValue = normalizeTransactionReferenceInput(event.target.value); setReferenceNumber(nextValue); setError(''); setSaveFailed(false); }} aria-invalid={Boolean(referenceNumberError)} disabled={saving} autoFocus placeholder="e.g. 123456" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-300/40 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-500/25 dark:disabled:bg-[#292c30]" />
          </div>
          {!referenceNumberOnly && <div>
            <label htmlFor="transaction-supporting-document" className="block text-xs font-medium text-slate-700 dark:text-slate-200">Supporting Document</label>
            <label htmlFor="transaction-supporting-document" className={`mt-1.5 flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition-colors focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-300/40 dark:border-slate-600/80 dark:bg-[#2d3035] dark:focus-within:border-slate-500 dark:focus-within:ring-slate-500/25 ${saving ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-500'}`}>
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-700/70 dark:text-slate-300">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" /></svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Choose file</span>
                <span id="transaction-supporting-document-help" className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">JPG or PNG up to 5 MB</span>
              </span>
              <input ref={fileInputRef} id="transaction-supporting-document" type="file" accept="image/jpeg,image/png" onChange={selectFile} disabled={saving} aria-describedby="transaction-supporting-document-help" className="sr-only" />
            </label>
            {(documentFile || initialReference?.supportingDocument) && (
              <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <p className="min-w-0 flex-1 truncate" title={documentFile?.name || initialReference.supportingDocument.originalName}>{documentFile ? `Selected: ${documentFile.name}` : `Current: ${initialReference.supportingDocument.originalName}`}</p>
                {documentFile && <button type="button" onClick={clearSelectedFile} disabled={saving} className="shrink-0 rounded px-1.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100" aria-label={`Remove ${documentFile.name}`}>Remove</button>}
              </div>
            )}
          </div>}
          {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200/70 px-5 py-3 dark:border-slate-700/70">
          {canDismiss && <button type="button" onClick={onSkip} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 disabled:opacity-50 dark:border-slate-600 dark:bg-[#2d3035] dark:text-slate-200 dark:hover:bg-[#373a40]">Cancel</button>}
          <button type="submit" disabled={saving || !hasReference || Boolean(referenceNumberError)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:focus-visible:ring-slate-300/40 dark:focus-visible:ring-offset-[#24262a]">{saving ? 'Saving…' : saveFailed ? 'Try Again' : saveLabel}</button>
        </div>
      </form>
    </div>
  );
};

export default TransactionReferenceModal;
