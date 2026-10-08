import React from 'react';

const MetricTrendLine = ({ trend, label, formatDelta, unit = '' }) => {
  if (trend.direction === 'neutral') {
    return <span className="text-slate-500 dark:text-slate-400">No change vs {label}</span>;
  }

  const isUp = trend.direction === 'up';
  const deltaText = `${isUp ? '+' : '-'}${formatDelta(Math.abs(trend.delta))}${unit}`;

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className={`whitespace-nowrap font-semibold ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
        <span aria-hidden="true">{isUp ? '↑' : '↓'}</span>
        {trend.percentage === null ? null : ` ${trend.percentage.toFixed(1)}%`}
      </span>
      <span className="whitespace-nowrap font-medium text-slate-500 dark:text-slate-400">
        {trend.percentage === null ? deltaText : `(${deltaText})`} vs {label}
      </span>
    </span>
  );
};

export default MetricTrendLine;
