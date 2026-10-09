import React from 'react';

const REPORT_DATE_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
  { value: 'specific_date', label: 'Select Date' },
  { value: 'custom', label: 'Custom Range' },
];

const ReportsDateSelector = ({
  value,
  onChange,
  specificDate,
  onSpecificDateChange,
  customStartDate,
  onCustomStartDateChange,
  customEndDate,
  onCustomEndDateChange,
  disabled = false,
  className = '',
  ariaLabel = 'Date range',
}) => {
  const maxDate = new Date().toISOString().split('T')[0];

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label={ariaLabel}
          className="appearance-none rounded-lg bg-gray-900 px-3 py-1.5 pr-8 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          style={{ minWidth: 140 }}
        >
          {REPORT_DATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2">
          <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
        </div>
      </div>

      {value === 'specific_date' && (
        <input
          type="date"
          value={specificDate}
          max={maxDate}
          disabled={disabled}
          onChange={(event) => onSpecificDateChange(event.target.value)}
          className="ml-2 rounded-lg border border-gray-900 bg-white px-2 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          style={{ minWidth: 140 }}
        />
      )}

      {value === 'custom' && (
        <div className="ml-2 flex items-center gap-2">
          <input
            type="date"
            value={customStartDate}
            max={maxDate}
            disabled={disabled}
            onChange={(event) => onCustomStartDateChange(event.target.value)}
            aria-label="From date"
            className="rounded-lg border border-gray-900 bg-white px-2 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            style={{ minWidth: 140 }}
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={customEndDate}
            max={maxDate}
            disabled={disabled}
            onChange={(event) => onCustomEndDateChange(event.target.value)}
            aria-label="To date"
            className="rounded-lg border border-gray-900 bg-white px-2 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            style={{ minWidth: 140 }}
          />
        </div>
      )}
    </div>
  );
};

export default ReportsDateSelector;
