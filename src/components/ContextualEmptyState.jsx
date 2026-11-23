import React from 'react';

const ContextualEmptyState = ({
    title,
    description,
    actionLabel = '',
    onAction,
    actionIcon = null,
    className = '',
}) => (
    <div role="status" className={`flex flex-col items-center justify-center px-4 py-7 text-center ${className}`}>
        <span aria-hidden="true" className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9ZM3.8 7.7 12 12l8.2-4.3M12 12v8.6" />
            </svg>
        </span>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-600">{description}</p>}
        {actionLabel && onAction && (
            <button
                type="button"
                onClick={onAction}
                className="mt-3 inline-flex min-h-9 max-w-full items-center justify-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-center text-xs font-semibold text-slate-50 transition-colors hover:border-slate-700 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
                {actionIcon}
                <span>{actionLabel}</span>
            </button>
        )}
    </div>
);

export default ContextualEmptyState;
