import React from 'react';
import toast from 'react-hot-toast';

// Note: we rely on react-hot-toast's id tracking via `toast.isActive` and
// `toast.dismiss`. Avoid a separate activeToasts map which caused id mismatches.

/**
 * Show a standardized minimal dark notification
 * @param {string} title - The main bold text
 * @param {string} subtitle - The detailed smaller text
 * @param {string} type - 'success', 'error', 'info' (determines icon and color)
 * @param {string} key - Unique key to prevent stacking (e.g. 'save-settings', 'cart-add')
 * @param {object} options - Optional CTA config
 * @param {string} options.actionLabel - Small action button label
 * @param {Function} options.onAction - Called when action button is clicked
 */
export const showToast = (title, subtitle, type = 'success', key = 'general', options = {}) => {
    const renderId = Date.now();
    const typeStyles = {
        success: {
            accent: 'bg-emerald-400',
            badgeClass: 'bg-emerald-500/12 border-emerald-400/25',
            iconClass: 'text-emerald-300 anim-icon-pop',
            duration: 2400,
            iconPath: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />,
        },
        error: {
            accent: 'bg-rose-400',
            badgeClass: 'bg-rose-500/12 border-rose-400/25',
            iconClass: 'text-rose-300 anim-icon-error',
            duration: 3600,
            iconPath: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />,
        },
        warning: {
            accent: 'bg-amber-400',
            badgeClass: 'bg-amber-500/12 border-amber-400/25',
            iconClass: 'text-amber-300 anim-icon-pop',
            duration: 3000,
            iconPath: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 4h.01m-8.938 4h17.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 17c-.77 1.333.192 3 1.732 3z" />,
        },
        info: {
            accent: 'bg-sky-400',
            badgeClass: 'bg-sky-500/12 border-sky-400/25',
            iconClass: 'text-sky-300 anim-icon-slide',
            duration: 3000,
            iconPath: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M12 22a10 10 0 100-20 10 10 0 000 20z" />,
        },
        download: {
            accent: 'bg-indigo-400',
            badgeClass: 'bg-indigo-500/12 border-indigo-400/25',
            iconClass: 'text-indigo-300 anim-icon-slide',
            duration: 2800,
            iconPath: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />,
        },
        print: {
            accent: 'bg-cyan-400',
            badgeClass: 'bg-cyan-500/12 border-cyan-400/25',
            iconClass: 'text-cyan-300 anim-icon-slide',
            duration: 2800,
            iconPath: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />,
        },
        delete: {
            accent: 'bg-rose-400',
            badgeClass: 'bg-rose-500/12 border-rose-400/25',
            iconClass: 'text-rose-300 anim-icon-error',
            duration: 3200,
            iconPath: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />,
        },
        save: {
            accent: 'bg-emerald-400',
            badgeClass: 'bg-emerald-500/12 border-emerald-400/25',
            iconClass: 'text-emerald-300 anim-icon-pop',
            duration: 2400,
            iconPath: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />,
        },
    };
    const resolvedType = typeStyles[type] ? type : 'info';
    const style = typeStyles[resolvedType];
    const icon = (
        <svg className={`w-4 h-4 ${style.iconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            {style.iconPath}
        </svg>
    );

    // 3. Trigger Toast
    let duration = style.duration;
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
                } max-w-sm w-auto bg-slate-900/70 shadow-[0_14px_38px_-16px_rgba(2,6,23,0.8)] rounded-xl border border-slate-600/40 ring-1 ring-white/10 backdrop-blur-xl pointer-events-auto flex flex-col overflow-hidden`}
            >
               <div className="px-3.5 py-3">
                    <div className="flex items-start gap-2.5">
                        <div className="shrink-0 pt-0.5">
                            <div className={`${style.badgeClass} w-8 h-8 rounded-lg border flex items-center justify-center`}>
                                {isLoadingType ? (
                                    <svg className="w-4 h-4 text-slate-200 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
                                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                    </svg>
                                ) : (
                                    icon
                                )}
                            </div>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-100 leading-5">
                                {title}
                            </p>
                            {subtitle && (
                                <p className="mt-0.5 text-xs text-slate-300/90 leading-4">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                        {options?.actionLabel ? (
                            <button
                                type="button"
                                onClick={() => {
                                    try {
                                        options?.onAction?.();
                                    } finally {
                                        toast.dismiss(t.id);
                                    }
                                }}
                                className="shrink-0 rounded-md border border-slate-500/60 bg-slate-800/70 px-2 py-1 text-[10px] font-semibold text-slate-100 hover:bg-slate-700/80 transition-colors"
                            >
                                {options.actionLabel}
                            </button>
                        ) : null}
                    </div>
                </div>
                {/* Timer Bar (hidden for loading toasts) */}
                {!isLoadingType && (
                    <div className="h-0.5 w-full bg-slate-600/45">
                        <div
                            key={`timer-${renderId}`} // Force remount of progress bar on update
                            className={`h-full ${style.accent}`}
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

