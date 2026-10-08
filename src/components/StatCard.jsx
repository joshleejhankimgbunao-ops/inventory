import React from 'react';

const StatCard = ({ title, value, subtitle = '', subtitleClassName = '', icon, onClick, accessibleLabel = '', titleClassName = '', valueClassName = '', refined = false, metricHierarchy = false }) => {
    // Monochrome minimalist approach
    const isKeyboardInteractive = Boolean(onClick && accessibleLabel);
    const handleKeyDown = (event) => {
        if (!isKeyboardInteractive || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onClick();
    };
    
    return (
        <div 
            onClick={onClick}
            onKeyDown={handleKeyDown}
            role={isKeyboardInteractive ? 'button' : undefined}
            tabIndex={isKeyboardInteractive ? 0 : undefined}
            aria-label={isKeyboardInteractive ? accessibleLabel : undefined}
            className={`relative overflow-hidden bg-white rounded-xl shadow-sm transition-all duration-300 group ${metricHierarchy ? 'h-full border border-gray-200 px-4 py-3' : 'border-x border-b border-gray-100 p-4'} ${onClick ? 'cursor-pointer transform hover:-translate-y-1 hover:shadow-lg' : 'cursor-default hover:shadow-lg'} ${isKeyboardInteractive ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900' : ''}`}
        >
            {!metricHierarchy && <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black"></div>}
            <div className="flex items-center justify-between">
                <div className="min-w-0">
                    <h3 className={`text-gray-500 ${titleClassName || 'text-xs'} ${metricHierarchy ? 'font-medium normal-case tracking-normal' : refined ? 'font-medium uppercase tracking-[0.08em]' : 'font-semibold uppercase tracking-wider'} ${metricHierarchy ? 'mb-1.5' : 'mb-1'} group-hover:text-gray-900 transition-colors`}>{title}</h3>
                    <div className={`${valueClassName || 'text-2xl'} font-semibold text-gray-900 tracking-tight`}>{value}</div>
                    {subtitle && <p className={`mt-0.5 text-[11px] font-medium leading-tight text-gray-500 ${subtitleClassName}`}>{subtitle}</p>}
                </div>
                <div className={`${refined ? 'p-2.5 rounded-lg shadow-none' : 'p-3 rounded-xl shadow-sm group-hover:scale-110 transition-transform duration-300'} bg-gray-900 text-white`}>
                    {icon}
                </div>
            </div>
        </div>
    );
};

export default StatCard;
