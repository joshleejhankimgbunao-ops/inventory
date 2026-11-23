import { getRecommendationPresentation } from '../utils/recommendationPresentation';

const displayValue = (value, unit) => `${value}${unit ? ` ${unit}` : ''}`;

const ChecklistIcon = ({ kind }) => {
    if (kind === 'match') return <svg aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m3.5 8 3 3 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    if (kind === 'warning') return <svg aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2.5 14 13H2L8 2.5Z" strokeLinejoin="round" /><path d="M8 6.2v3.3m0 2h.01" strokeLinecap="round" /></svg>;
    return <svg aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5" /><path d="M5.5 8h5" strokeLinecap="round" /></svg>;
};

const RecommendationBasis = ({ item }) => {
    const basis = item?.recommendation;
    const presentation = getRecommendationPresentation(basis);
    if (!presentation) return null;
    const savedStaffRows = presentation.checklist.filter((row) => row.staff);
    const factualRows = presentation.checklist.filter((row) => !row.staff);
    const review = basis.staffReview?.record;
    const showReview = basis.staffReview?.identityCurrent === false || ['approved', 'rejected'].includes(review?.decision);
    return (
        <div className="mt-2 min-w-0 border-t border-slate-100 pt-2 text-xs leading-snug text-slate-600 dark:border-slate-700 dark:text-slate-300" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300"><span>{presentation.source}</span><span aria-hidden="true">·</span><span className={presentation.sourceStatus === 'Active' || presentation.sourceStatus === 'Approved' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>{presentation.sourceStatus}</span>{presentation.systemReviewStatus && <><span aria-hidden="true">·</span><span>System review: {presentation.systemReviewStatus}</span></>}</p>
            {presentation.compatibilityNote && <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Compatibility: {presentation.status}</p>}
            {(presentation.checklist.length > 0 || presentation.staffChecklist.length > 0) && <p className="mt-2 font-semibold text-slate-800 dark:text-slate-100">Why Recommended?</p>}
            {showReview && <p className="mt-1 text-[11px] text-slate-500">Staff review: {basis.staffReview.identityCurrent === false ? 'Identity changed' : review?.decision === 'approved' ? 'Approved' : 'Rejected'}</p>}
            {savedStaffRows.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Staff-provided reasons; not independently verified.</p>}
            {savedStaffRows.length > 0 && <ul className="mt-1.5 space-y-1.5" aria-label="Staff recommendation reasons">{savedStaffRows.map((row) => (
                <li key={row.key} data-reason-source="staff" className="flex min-w-0 items-start gap-1.5 leading-4"><ChecklistIcon kind={row.kind} /><span className="min-w-0 break-words text-slate-700 dark:text-slate-200">{row.text}</span></li>
            ))}</ul>}
            {savedStaffRows.length > 0 && factualRows.length > 0 && <p className="mt-2 text-[11px] text-slate-500">Recorded facts and cautions</p>}
            {factualRows.length > 0 && <ul className="mt-1.5 space-y-1.5" aria-label="Recommendation reasons">
                {factualRows.map((row) => (
                    <li key={row.key} data-reason-source={row.staff ? 'staff' : 'system'} className="flex min-w-0 items-start gap-1.5 leading-4">
                        <ChecklistIcon kind={row.kind} />
                        <span className="min-w-0 break-words text-slate-700 dark:text-slate-200">{row.text}</span>
                    </li>
                ))}
            </ul>}
            {presentation.staffChecklist.length > 0 && <div className="mt-2"><p className="text-[11px] text-slate-500">Staff-provided reasons; not independently verified.</p><ul aria-label="Staff-provided reasons" className="mt-1 space-y-1.5">{presentation.staffChecklist.map((row) => <li key={row.key} data-reason-source="staff" className="flex min-w-0 items-start gap-1.5 leading-4"><ChecklistIcon kind={row.kind} /><span className="min-w-0 break-words text-slate-700 dark:text-slate-200">{row.text}</span></li>)}</ul></div>}
            {((presentation.additionalMatches.length > 0 || presentation.additionalDifferences.length > 0 || presentation.additionalMissing.length > 0 || presentation.showDataLimitationsInDetails) || presentation.showStaffReasonInDetails || presentation.showLimitationsInDetails || presentation.showSystemSuggestionInDetails || basis.adminJustification?.updatedByName || review || basis.availability?.reservedQuantity > 0 || basis.availability?.requestedQuantity > 1) && (
                <details className="mt-1.5">
                    <summary className="w-fit cursor-pointer rounded-sm text-[11px] font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:text-slate-300">More details</summary>
                    <div className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-2.5 dark:border-slate-600">
                        {presentation.additionalMatches.length > 0 && <div><p className="font-semibold text-slate-700 dark:text-slate-200">More recorded matches</p>{presentation.additionalMatches.map((row) => <p key={row.key}>{row.text}</p>)}</div>}
                        {presentation.additionalDifferences.map((row) => <p key={row.key}>Different {row.label.toLowerCase()}: {displayValue(row.targetValue, row.unit)} and {displayValue(row.candidateValue, row.candidateUnit ?? row.unit)}.</p>)}
                        {presentation.additionalMissing.length > 0 && <p>Missing product details: {presentation.additionalMissing.map((row) => row.label).join(', ')}.</p>}
                        {presentation.showDataLimitationsInDetails && <p>Some saved product details cannot be compared yet.</p>}
                        {(basis.availability?.reservedQuantity > 0 || basis.availability?.requestedQuantity > 1) && <p>{basis.availability.availableQuantity} available after items in cart; {basis.availability.requestedQuantity} requested.</p>}
                        {(presentation.showStaffReasonInDetails || presentation.showLimitationsInDetails || presentation.showSystemSuggestionInDetails || basis.adminJustification?.updatedByName) && <div className="border-t border-slate-200 pt-1.5 dark:border-slate-700"><p className="font-semibold text-slate-700 dark:text-slate-200">Recommendation explanation</p>{(presentation.showStaffReasonInDetails || presentation.showSystemSuggestionInDetails) && basis.adminJustification?.text && <p className="whitespace-pre-wrap break-words"><span className="font-medium">Displayed explanation: </span>{basis.adminJustification.text}</p>}{presentation.showSystemSuggestionInDetails && <p className="mt-1 whitespace-pre-wrap break-words"><span className="font-medium">Original system suggestion: </span>{basis.systemSuggestion}</p>}{presentation.showLimitationsInDetails && <p className="mt-1 whitespace-pre-wrap break-words">Important limitations: {basis.adminJustification.limitations}</p>}{basis.adminJustification?.updatedByName && <p className="mt-1">Last edited by {basis.adminJustification.updatedByName}.</p>}</div>}
                        {review && <div className="border-t border-slate-200 pt-1.5 dark:border-slate-700">{review.reviewReason && <p className="whitespace-pre-wrap break-words">Review note: {review.reviewReason}</p>}<p>Reviewed by {review.updatedByName || 'staff'}{review.updatedAt && ` on ${new Date(review.updatedAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}`}.</p><p>Staff approval does not independently verify compatibility.</p></div>}
                    </div>
                </details>
            )}
        </div>
    );
};

export default RecommendationBasis;
