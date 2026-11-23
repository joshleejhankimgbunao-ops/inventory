import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RECOMMENDATION_BASIS_LIMITS, validateRecommendationBasis } from '../utils/recommendationBasis';

const RecommendationBasisEditor = ({ target, candidate, initialBasis = {}, mode = 'edit', reviewDecision, restoreExclusions = false, onSave, onClose }) => {
    const isManualBasis = mode === 'add' || mode === 'edit' || mode === 'legacy-edit';
    const systemSuggestion = String(initialBasis.systemSuggestion || '').trim();
    const [justification, setJustification] = useState(initialBasis.justification || systemSuggestion || '');
    const [limitations, setLimitations] = useState(initialBasis.limitations || '');
    const [decision, setDecision] = useState(reviewDecision || initialBasis.decision || 'not_reviewed');
    const [reviewReason, setReviewReason] = useState(initialBasis.reviewReason || '');
    const [reasons, setReasons] = useState(() => (initialBasis.staffReasons || []).map((row, index) => ({ ...row, key: `reason-${index}` })));
    const reasonsEdited = useRef(false);
    const nextReasonKey = useRef((initialBasis.staffReasons || []).length);
    const pendingFocus = useRef(null);
    const addReasonButton = useRef(null);
    const [error, setError] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const submitLock = useRef(false);
    const firstInput = useRef(null);
    const formRef = useRef(null);
    useEffect(() => {
        const previousFocus = document.activeElement;
        (firstInput.current || addReasonButton.current)?.focus();
        return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
    }, []);
    useEffect(() => {
        if (!pendingFocus.current) return;
        const control = formRef.current?.querySelector(`[data-reason-key="${pendingFocus.current}"]`);
        (control || addReasonButton.current)?.focus();
        pendingFocus.current = null;
    }, [reasons]);
    const updateReason = (key, changes) => { reasonsEdited.current = true; setReasons((current) => current.map((row) => row.key === key ? { ...row, ...changes } : row)); };
    const addReason = () => {
        reasonsEdited.current = true;
        const key = `reason-${nextReasonKey.current++}`;
        pendingFocus.current = key;
        setReasons((current) => current.length >= RECOMMENDATION_BASIS_LIMITS.reasonCount ? current : [...current, { key, indicator: 'neutral', text: '' }]);
    };
    const removeReason = (index) => {
        reasonsEdited.current = true;
        pendingFocus.current = reasons[index + 1]?.key || reasons[index - 1]?.key || 'add';
        setReasons((current) => current.filter((_, rowIndex) => rowIndex !== index));
    };
    const moveReason = (index, direction) => {
        reasonsEdited.current = true;
        setReasons((current) => {
            const result = [...current];
            [result[index], result[index + direction]] = [result[index + direction], result[index]];
            return result;
        });
    };

    const submit = async (event) => {
        event.preventDefault();
        if (submitLock.current) return;
        const values = { justification: justification.trim(), limitations: limitations.trim(), staffReasons: reasons.map(({ indicator, text }) => ({ indicator, text: text.trim() })) };
        if (mode === 'add') {
            values.systemGenerated = initialBasis.systemGenerated === true;
            values.systemSuggestion = systemSuggestion;
        }
        if (initialBasis.staffReasons === undefined && !reasonsEdited.current) delete values.staffReasons;
        const validationError = validateRecommendationBasis(values);
        if (validationError) { setError(validationError); return; }
        if (mode === 'review' || mode === 'staff') {
            values.decision = decision;
            values.reviewReason = reviewReason.trim();
            if (mode === 'review') values.restoreExclusions = restoreExclusions;
            if (values.reviewReason.length > RECOMMENDATION_BASIS_LIMITS.reviewReason) { setError('Review reason is too long.'); return; }
        }
        submitLock.current = true;
        setIsSaving(true);
        setError('');
        try { await onSave(values); } catch (failure) {
            setError(failure?.message || 'Unable to save the recommendation basis. Your input has been retained.');
        } finally { submitLock.current = false; setIsSaving(false); }
    };
    const handleKeyDown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!submitLock.current) onClose(); }
        if (event.key !== 'Tab') return;
        const controls = [...formRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary')].filter((node) => node.getClientRects().length > 0);
        if (!controls.length) { event.preventDefault(); formRef.current.focus(); return; }
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const inputClass = 'mt-1 w-full resize-y rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
    const reviewCopy = decision === 'approved'
        ? { title: 'Approve Recommendation?', message: `Approve ${candidate.name} as a recommendation?`, action: 'Approve' }
        : decision === 'rejected'
            ? { title: 'Reject Recommendation?', message: `Stop recommending ${candidate.name} automatically?`, action: 'Reject' }
            : { title: 'Restore Recommendation?', message: `Allow ${candidate.name} to be considered for automatic recommendations again?`, action: 'Restore' };
    const dialog = (
        <div className="app-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
            <form ref={formRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="recommendation-basis-title" aria-busy={isSaving} onSubmit={submit} onKeyDown={handleKeyDown} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <header className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
                    <h3 id="recommendation-basis-title" className="text-sm font-semibold text-slate-900 dark:text-slate-100">{mode === 'review' ? reviewCopy.title : mode === 'staff' ? 'Staff Justification' : mode === 'add' ? 'Add Recommendation' : 'Edit Basis'}</h3>
                    {mode === 'review' && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{reviewCopy.message}</p>}
                </header>
                <div className="min-h-0 space-y-3 overflow-y-auto p-4">
                    <dl className="space-y-2 rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
                        <div><dt className="text-[10px] text-slate-500">Current product</dt><dd className="break-words font-medium text-slate-800 dark:text-slate-100">{target.name} <span className="break-all font-mono text-[10px] text-slate-500">({target.code})</span></dd></div>
                        <div><dt className="text-[10px] text-slate-500">Recommended alternative</dt><dd className="break-words font-medium text-slate-800 dark:text-slate-100">{candidate.name} <span className="break-all font-mono text-[10px] text-slate-500">({candidate.code})</span></dd></div>
                        {mode === 'add' && <div><dt className="text-[10px] text-slate-500">Source</dt><dd className="font-medium text-slate-800 dark:text-slate-100">Manually Added{initialBasis.systemGenerated === true ? ' · System-generated suggestion' : ''}</dd></div>}
                    </dl>
                    {(candidate.isArchived || candidate.isActive === false) && <p className="text-[10px] text-amber-700 dark:text-amber-400">This SKU is archived. Its saved basis can be documented; it remains unavailable in POS.</p>}
                    {isManualBasis && <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        {systemSuggestion && <div>
                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{initialBasis.systemSuggestionIsHistorical === false ? 'Current System Suggestion (original not recorded)' : 'System Suggestion (Original)'}</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-xs font-normal text-slate-600 dark:text-slate-300">{systemSuggestion}</p>
                        </div>}
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-200" htmlFor="manual-recommendation-justification">Displayed Explanation <span className="font-normal text-slate-400">(Optional)</span>
                            <textarea id="manual-recommendation-justification" rows={3} value={justification} onChange={(event) => setJustification(event.target.value)} maxLength={RECOMMENDATION_BASIS_LIMITS.justification} disabled={isSaving} placeholder="Explain why this alternative is recommended" className={inputClass} />
                        </label>
                        {systemSuggestion && <button type="button" disabled={isSaving || justification === systemSuggestion} onClick={() => setJustification(systemSuggestion)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700">Reset to System Suggestion</button>}
                    </section>}
                    <section aria-label="Staff-provided reasons" className="space-y-2">
                        <div><p className="text-xs font-medium text-slate-700 dark:text-slate-200">Recommendation Reasons <span className="font-normal text-slate-400">(Optional)</span></p><p className="mt-1 text-xs text-slate-500">Your reasons do not change compatibility checks.</p></div>
                        {reasons.map((row, index) => (
                            <div key={row.key} className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]">
                                    <select aria-label={`Indicator for reason ${index + 1}`} value={row.indicator} onChange={(event) => updateReason(row.key, { indicator: event.target.value })} disabled={isSaving} className="h-8 min-w-0 rounded-lg border border-slate-200 bg-white px-1.5 text-xs text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                                        <option value="check">{'\u2713 Positive'}</option><option value="neutral">= Neutral</option><option value="warning">{'\u26a0 Warning'}</option>
                                    </select>
                                    <input ref={index === 0 ? firstInput : undefined} data-reason-key={row.key} aria-label={`Reason ${index + 1}`} value={row.text} onChange={(event) => updateReason(row.key, { text: event.target.value })} disabled={isSaving} maxLength={RECOMMENDATION_BASIS_LIMITS.reasonText} placeholder="Add a short reason" className="h-8 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                                    <div className="col-span-2 flex justify-end gap-1 sm:col-span-1">
                                        <button type="button" disabled={isSaving || index === 0} onClick={() => moveReason(index, -1)} aria-label={`Move reason ${index + 1} up`} title="Move up" className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-40"><svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5 14 7-7 7 7" /></svg></button>
                                        <button type="button" disabled={isSaving || index === reasons.length - 1} onClick={() => moveReason(index, 1)} aria-label={`Move reason ${index + 1} down`} title="Move down" className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-40"><svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5 10 7 7 7-7" /></svg></button>
                                        <button type="button" disabled={isSaving} aria-label={`Remove reason ${index + 1}`} title="Remove reason" onClick={() => removeReason(index)} className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:opacity-50"><span aria-hidden="true">&times;</span></button>
                                    </div>
                            </div>
                        ))}
                        <button ref={addReasonButton} type="button" onClick={addReason} disabled={isSaving || reasons.length >= RECOMMENDATION_BASIS_LIMITS.reasonCount} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50 dark:text-slate-200">+ Add Reason</button>
                    </section>
                    {mode === 'review' && <>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-200" htmlFor="recommendation-review-decision">Staff review
                            <select id="recommendation-review-decision" value={decision} onChange={(event) => setDecision(event.target.value)} disabled={isSaving} className={inputClass}>
                                <option value="not_reviewed">Not Reviewed</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
                            </select>
                        </label>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-200" htmlFor="recommendation-review-reason">Review Reason (Optional)
                            <textarea id="recommendation-review-reason" rows={2} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} maxLength={RECOMMENDATION_BASIS_LIMITS.reviewReason} disabled={isSaving} className={inputClass} />
                        </label>
                        {restoreExclusions && <p className="text-xs text-amber-800">This also lifts its previous block. Product and stock checks still apply.</p>}
                    </>}
                    <details open={mode === 'staff'} className="text-xs">
                    <summary className="w-fit cursor-pointer rounded text-xs font-medium text-slate-600 focus-visible:ring-2 focus-visible:ring-slate-500">{mode === 'staff' ? 'Staff Justification and Limitations' : 'Additional notes'}{initialBasis.justification || initialBasis.limitations ? ' (saved text preserved)' : ''}</summary>
                    <div className="mt-2 space-y-3">
                    {!isManualBasis && <label className="block text-xs font-medium text-slate-700 dark:text-slate-200" htmlFor="manual-recommendation-justification">{mode === 'staff' ? 'Staff Justification' : 'Manual Justification'} <span className="font-normal text-slate-400">(Optional)</span>
                        <textarea id="manual-recommendation-justification" rows={3} value={justification} onChange={(event) => setJustification(event.target.value)} maxLength={RECOMMENDATION_BASIS_LIMITS.justification} disabled={isSaving} placeholder="Add staff context for this recommendation" className={inputClass} />
                    </label>}
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200" htmlFor="manual-recommendation-limitations">Important Differences / Limitations <span className="font-normal text-slate-400">(Optional)</span>
                        <textarea id="manual-recommendation-limitations" rows={3} value={limitations} onChange={(event) => setLimitations(event.target.value)} maxLength={RECOMMENDATION_BASIS_LIMITS.limitations} disabled={isSaving} placeholder="Document any known restrictions or differences" className={inputClass} />
                    </label>
                    </div>
                    </details>
                    {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
                </div>
                <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
                    <button type="button" disabled={isSaving} onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
                    <button type="submit" disabled={isSaving} className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'review' && decision === 'rejected' ? 'bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500' : 'bg-[#111827] hover:bg-slate-800 focus-visible:ring-slate-500'}`}>{isSaving ? 'Saving…' : mode === 'review' ? reviewCopy.action : mode === 'add' ? 'Add Recommendation' : 'Save Changes'}</button>
                </footer>
            </form>
        </div>
    );
    // Animated dashboard containers establish their own fixed-position context.
    // Keep this editor anchored to the viewport, including during transitions.
    return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
};

export default RecommendationBasisEditor;
