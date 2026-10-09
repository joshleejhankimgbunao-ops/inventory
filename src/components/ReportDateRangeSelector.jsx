import React from 'react';
import { getExportPresetRange, toDateInputValue } from '../utils/reportExportRange';

const ReportDateRangeSelector = ({
  from,
  to,
  onChange,
  disabled = false,
  label = 'Export Range',
  error = '',
}) => {
  const maxDate = toDateInputValue(new Date());

  const applyPreset = (preset) => {
    onChange(getExportPresetRange(preset));
  };

  return (
    <div>
      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {[
          ['week', 'This Week'],
          ['month', 'This Month'],
          ['year', 'This Year'],
        ].map(([value, presetLabel]) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => applyPreset(value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-300 dark:hover:bg-[#373a40]"
          >
            {presetLabel}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          From
          <input
            type="date"
            value={from}
            max={maxDate}
            disabled={disabled}
            onChange={(event) => onChange({ from: event.target.value, to })}
            className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-300/40 disabled:opacity-60 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-100 dark:[color-scheme:dark] dark:focus:border-slate-500 dark:focus:ring-slate-500/25"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          To
          <input
            type="date"
            value={to}
            max={maxDate}
            disabled={disabled}
            onChange={(event) => onChange({ from, to: event.target.value })}
            className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-300/40 disabled:opacity-60 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-100 dark:[color-scheme:dark] dark:focus:border-slate-500 dark:focus:ring-slate-500/25"
          />
        </label>
      </div>
      {error && <p role="alert" className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>}
    </div>
  );
};

export default ReportDateRangeSelector;
