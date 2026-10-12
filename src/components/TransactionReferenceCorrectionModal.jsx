import { useRef, useState } from 'react';
import { correctSaleTransactionReferenceApi } from '../services/inventoryApi';
import { getTransactionReferenceNumberError, normalizeTransactionReferenceInput } from '../utils/transactionReference';

const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;

const TransactionReferenceCorrectionModal = ({ saleId, currentReference, onClose, onSaved }) => {
  const currentNumber = String(currentReference?.referenceNumber || '');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [documentFile, setDocumentFile] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const hasNewReference = Boolean(referenceNumber.trim());
  const hasChange = hasNewReference || Boolean(documentFile);

  const selectFile = (event) => {
    const file = event.target.files?.[0] || null;
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
    setDocumentFile(file);
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    const referenceError = hasNewReference ? getTransactionReferenceNumberError(referenceNumber) : '';
    if (referenceError) return setError(referenceError);
    if (!reason.trim()) return setError('Correction reason is required.');
    if (!hasChange) return setError('Change the Reference No. or choose a new Supporting Document.');
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const updated = await correctSaleTransactionReferenceApi(saleId, {
        referenceNumber: hasNewReference ? referenceNumber.trim() : undefined,
        documentFile,
        reason: reason.trim(),
      });
      onSaved(updated);
    } catch (saveError) {
      setError(saveError.message || 'Unable to save the correction.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="app-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="correct-reference-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] dark:border-slate-700/80 dark:bg-[#24262a] dark:shadow-[0_20px_50px_-24px_rgba(0,0,0,0.6)]">
        <div className="border-b border-slate-200/70 px-5 py-4 dark:border-slate-700/70">
          <h2 id="correct-reference-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">Correct Transaction Reference</h2>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Current Reference</p>
            <p className="mt-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-[#292c30] dark:text-slate-200">{currentNumber || 'Supporting document only'}</p>
          </div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
            New Reference
            <input type="text" inputMode="numeric" value={referenceNumber} placeholder="Enter new reference number" onChange={(event) => { setReferenceNumber(normalizeTransactionReferenceInput(event.target.value)); setError(''); }} disabled={saving} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-300/40 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-100 dark:placeholder:text-slate-500" />
          </label>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
            New Supporting Document <span className="font-normal text-slate-400">Optional</span>
            <input type="file" accept="image/jpeg,image/png" onChange={selectFile} disabled={saving} className="mt-1.5 block w-full rounded-lg border border-slate-200 bg-white p-1 text-xs text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-medium dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-400 dark:file:bg-[#373a40] dark:file:text-slate-200" />
          </label>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
            Reason
            <textarea value={reason} placeholder="Enter reason for correction" onChange={(event) => { setReason(event.target.value); setError(''); }} maxLength={500} rows={3} disabled={saving} className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-300/40 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-100 dark:placeholder:text-slate-500" />
          </label>
          {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200/70 px-5 py-3 dark:border-slate-700/70">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-[#2d3035] dark:text-slate-200 dark:hover:bg-[#373a40]">Cancel</button>
          <button type="submit" disabled={saving || !reason.trim() || !hasChange} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900">{saving ? 'Saving…' : 'Save Correction'}</button>
        </div>
      </form>
    </div>
  );
};

export default TransactionReferenceCorrectionModal;
