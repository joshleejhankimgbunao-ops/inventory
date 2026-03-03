import React from 'react';
import toast from 'react-hot-toast';

// Note: we rely on react-hot-toast's id tracking via `toast.isActive` and
// `toast.dismiss`. Avoid a separate activeToasts map which caused id mismatches.

/**
 * Show a standardized dark-themed notification
 * @param {string} title - The main bold text
 * @param {string} subtitle - The detailed smaller text
 * @param {string} type - 'success', 'error', 'info' (determines icon and color)
 * @param {string} key - Unique key to prevent stacking (e.g. 'save-settings', 'cart-add')
 */
export const showToast = (title, subtitle, type = 'success', key = 'general') => {
    // 1. Generate unique ID for this render to force animation reset on specific elements
    const renderId = Date.now();

    // 2. Configuration based on type
    let icon;
    let badgeClass;
    let iconClass;

    if (type === 'success') {
        badgeClass = 'bg-green-900/40 border-green-800';
        iconClass = 'text-green-400';
        icon = (
            <svg className={`w-8 h-8 ${iconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
        );
    } else if (type === 'error') {
        badgeClass = 'bg-red-900/40 border-red-800';
        iconClass = 'text-red-400';
        icon = (
             <svg className={`w-8 h-8 ${iconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
        );
    } else if (type === 'warning') {
        badgeClass = 'bg-amber-900/40 border-amber-800';
        iconClass = 'text-amber-400';
        icon = (
            <svg className={`w-8 h-8 ${iconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
        );
    } else if (type === 'info') {
        badgeClass = 'bg-blue-900/40 border-blue-800';
        iconClass = 'text-blue-400';
        icon = (
            <svg className={`w-8 h-8 ${iconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
        );
    } else if (type === 'download') {
        badgeClass = 'bg-indigo-900/40 border-indigo-800';
        iconClass = 'text-indigo-400';
        icon = (
            <svg className={`w-8 h-8 ${iconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
        );
    } else if (type === 'print') {
        badgeClass = 'bg-cyan-900/40 border-cyan-800';
        iconClass = 'text-cyan-400';
        icon = (
            <svg className={`w-8 h-8 ${iconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path>
            </svg>
        );
    } else if (type === 'delete') {
        badgeClass = 'bg-red-900/40 border-red-800';
        iconClass = 'text-red-400';
        icon = (
            <svg className={`w-8 h-8 ${iconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
        );
    } else if (type === 'save') {
        badgeClass = 'bg-emerald-900/40 border-emerald-800';
        iconClass = 'text-emerald-400';
        icon = (
            <svg className={`w-8 h-8 ${iconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path>
            </svg>
        );
    }

    // 3. Trigger Toast
    let duration = 4000;
    // Use a slightly longer animation time for the bar so the toast disappears
    // just *before* the bar hits absolute zero.
    let animationDuration = duration + 200;

    // Special handling for loading state: show an indefinite toast without
    // a progress bar and a spinner icon. This toast must be replaced later
    // by calling `showToast(..., sameKey)` or `toast.dismiss(id)`.
    const isLoadingType = type === 'loading';
    if (isLoadingType) {
        duration = Infinity;
        animationDuration = 0;
    }
    
    // Prevent duplicate toasts: for string keys, dismiss any active toast
    // with the same id before showing a new one. For numeric keys (e.g.
    // ids returned from `toast.loading`), do not dismiss so that passing the
    // numeric id as `id` to `toast.custom` will update/replace the loading
    // toast in-place.
    try {
        if (typeof key !== 'number' && toast.isActive(key)) {
            toast.dismiss(key);
        }
    } catch (err) {
        // ignore errors from toast.isActive/dismiss
    }

    const newId = toast.custom(
        (t) => (
            <div className={`${
                    t.visible ? 'animate-enter' : 'animate-leave'
                } max-w-sm w-auto bg-[#333333] shadow-[0_10px_15px_-3px_rgba(0,0,0,0.5)] rounded-2xl border border-gray-600 pointer-events-auto flex flex-col ring-1 ring-black ring-opacity-5 overflow-hidden`}
            >
               <div className="p-4">
                    <div className="flex items-start">
                        <div className="flex-shrink-0 pt-0.5">
                            <div className={`${badgeClass} p-3 rounded-2xl border shadow-sm flex items-center justify-center`}>
                                {isLoadingType ? (
                                    <svg className="w-6 h-6 text-white animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.15" />
                                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                                    </svg>
                                ) : (
                                    icon
                                )}
                            </div>
                        </div>
                        <div className="ml-3 flex-1 flex flex-col justify-center min-h-[50px]">
                            <p className="text-base font-extrabold text-white">
                                {title}
                            </p>
                            {subtitle && (
                                <p className="mt-1 text-xs font-medium text-gray-300">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
                {/* Timer Bar (hidden for loading toasts) */}
                {!isLoadingType && (
                    <div className="h-1 w-full bg-gray-700/50">
                        <div
                            key={`timer-${renderId}`} // Force remount of progress bar on update
                            className={`h-full ${type === 'success' ? 'bg-green-500' : type === 'error' || type === 'delete' ? 'bg-red-500' : type === 'warning' ? 'bg-amber-500' : type === 'download' ? 'bg-indigo-500' : type === 'print' ? 'bg-cyan-500' : type === 'save' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                            style={{
                                animation: t.visible ? `toast-progress ${animationDuration}ms linear forwards` : 'none',
                                width: t.visible ? '100%' : '0%'
                            }}
                        />
                    </div>
                )}
            </div>
        ),
        { 
            duration: duration, 
            position: 'top-right',
            id: key 
        }
    );

    // 4. Return the toast id (may be numeric or string depending on `key`)
    return newId;
};
