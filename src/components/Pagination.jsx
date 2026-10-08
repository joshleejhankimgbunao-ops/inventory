import React, { useMemo, useRef, useState } from 'react';

const getPageItems = (currentPage, totalPages) => {
    if (totalPages <= 5) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const nearbyStart = currentPage <= 3 ? 2 : Math.max(2, currentPage - 2);
    const nearbyEnd = currentPage >= totalPages - 2 ? totalPages - 1 : Math.min(totalPages - 1, currentPage + 2);
    const pages = [1];

    if (nearbyStart > 2) pages.push('start-ellipsis');
    for (let page = nearbyStart; page <= nearbyEnd; page += 1) pages.push(page);
    if (nearbyEnd < totalPages - 1) pages.push('end-ellipsis');
    pages.push(totalPages);

    return pages;
};

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100];

const Pagination = ({ currentPage, totalPages, onPageChange, pageSize, onPageSizeChange }) => {
    const [pageInput, setPageInput] = useState('');
    const [isPageInputInvalid, setIsPageInputInvalid] = useState(false);
    const pageInputRef = useRef(null);
    const safeTotalPages = Math.max(0, Number(totalPages) || 0);
    const safeCurrentPage = Math.min(Math.max(1, Number(currentPage) || 1), Math.max(safeTotalPages, 1));
    const pageItems = useMemo(
        () => getPageItems(safeCurrentPage, safeTotalPages),
        [safeCurrentPage, safeTotalPages],
    );

    const canChangePageSize = Number.isFinite(pageSize) && typeof onPageSizeChange === 'function';
    const showPageNavigation = safeTotalPages > 1;

    if (!showPageNavigation && !canChangePageSize) return null;

    const buttonClass = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 dark:focus-visible:ring-gray-300';
    const inactivePageButtonClass = 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-700';
    const activePageButtonClass = 'border-gray-900 bg-gray-900 shadow-sm hover:border-gray-900 hover:bg-gray-800 dark:border-slate-600 dark:bg-slate-600 dark:hover:border-slate-500 dark:hover:bg-slate-500';
    const disabledClass = 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300 hover:border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-600 dark:hover:border-gray-700 dark:hover:bg-gray-800';
    const submitPageJump = (event) => {
        event.preventDefault();
        const value = pageInput.trim();

        if (!value) {
            return;
        }

        const page = Number(value);
        if (!Number.isSafeInteger(page) || page < 1 || page > safeTotalPages) {
            setIsPageInputInvalid(true);
            pageInputRef.current?.focus();
            return;
        }

        onPageChange(page);
        setPageInput('');
        setIsPageInputInvalid(false);
    };

    return (
        <nav className="flex w-full min-w-0 flex-wrap items-center justify-between gap-4 sm:w-auto sm:justify-end" aria-label="Pagination">
            {canChangePageSize && (
                <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                    <span className="whitespace-nowrap">Rows per page:</span>
                    <select
                        value={pageSize}
                        onChange={(event) => onPageSizeChange(Number(event.target.value))}
                        aria-label="Rows per page"
                        className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 outline-none transition-colors hover:border-gray-300 focus:border-gray-900 focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-500 dark:focus:border-gray-300 dark:focus:ring-gray-300 dark:focus:ring-offset-gray-900"
                    >
                        {PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                </label>
            )}
            {showPageNavigation && <div className="flex min-w-0 items-center gap-1">
                <button
                type="button"
                aria-label="Previous page"
                onClick={() => onPageChange(safeCurrentPage - 1)}
                disabled={safeCurrentPage === 1}
                className={`${buttonClass} ${safeCurrentPage === 1 ? disabledClass : inactivePageButtonClass}`}
            >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                </button>
                {pageItems.map((item) => (
                typeof item === 'number' ? (
                    <button
                        type="button"
                        key={item}
                        onClick={() => onPageChange(item)}
                        aria-label={`Page ${item}`}
                        aria-current={item === safeCurrentPage ? 'page' : undefined}
                        className={`${buttonClass} ${item === safeCurrentPage ? activePageButtonClass : inactivePageButtonClass}`}
                    >
                        <span className={item === safeCurrentPage ? 'pointer-events-none block text-xs font-semibold leading-none text-white' : 'pointer-events-none block leading-none'}>{item}</span>
                    </button>
                ) : (
                    <span key={item} className="flex h-8 w-4 shrink-0 items-center justify-center text-xs font-semibold text-gray-400 dark:text-gray-500" aria-hidden="true">...</span>
                )
                ))}
                <button
                type="button"
                aria-label="Next page"
                onClick={() => onPageChange(safeCurrentPage + 1)}
                disabled={safeCurrentPage === safeTotalPages}
                className={`${buttonClass} ${safeCurrentPage === safeTotalPages ? disabledClass : inactivePageButtonClass}`}
            >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                </button>
            </div>}
            {showPageNavigation && safeTotalPages > 5 && (
                <form className="relative flex shrink-0 items-center gap-2" onSubmit={submitPageJump}>
                    <label htmlFor="pagination-go-to-page" className="text-xs font-semibold text-gray-600 dark:text-gray-300">Page</label>
                    <div>
                        <input
                            ref={pageInputRef}
                            id="pagination-go-to-page"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={pageInput}
                            onChange={(event) => {
                                setPageInput(event.target.value.replace(/\D/g, ''));
                                setIsPageInputInvalid(false);
                            }}
                            aria-label="Go to page"
                            aria-describedby={isPageInputInvalid ? 'pagination-go-to-page-error' : undefined}
                            aria-invalid={isPageInputInvalid || undefined}
                            placeholder="Page"
                            className={`h-8 w-14 rounded-lg border bg-white px-1.5 text-center text-xs font-semibold text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-gray-300 ${isPageInputInvalid ? 'border-rose-400 focus:border-rose-500 dark:border-rose-500' : 'border-gray-200 focus:border-gray-900 dark:border-gray-600 dark:focus:border-gray-300'}`}
                        />
                    </div>
                    {isPageInputInvalid && <span id="pagination-go-to-page-error" className="absolute bottom-full right-0 z-20 mb-1 whitespace-nowrap rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold leading-none text-rose-700 shadow-sm dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300" role="status">Page must be 1–{safeTotalPages}</span>}
                </form>
            )}
        </nav>
    );
};

export default Pagination;
