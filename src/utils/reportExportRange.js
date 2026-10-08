const pad = (value) => String(value).padStart(2, '0');

export const toDateInputValue = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const parseDateInput = (value, { endOfDay = false } = {}) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1])
    || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3])) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
};

export const getExportPresetRange = (preset, now = new Date()) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  if (preset === 'week') start.setDate(start.getDate() - 7);
  if (preset === 'month') start.setDate(1);
  if (preset === 'year') start.setMonth(0, 1);
  return { from: toDateInputValue(start), to: toDateInputValue(today) };
};

export const getDefaultReportExportRange = ({
  dateRange,
  customStartDate = '',
  customEndDate = '',
  specificDate = '',
  availableDates = [],
  now = new Date(),
} = {}) => {
  if (dateRange === 'today') return getExportPresetRange('today', now);
  if (dateRange === 'week') return getExportPresetRange('week', now);
  if (dateRange === 'month') return getExportPresetRange('month', now);
  if (dateRange === 'year') return getExportPresetRange('year', now);
  if (dateRange === 'specific_date' && parseDateInput(specificDate)) {
    return { from: specificDate, to: specificDate };
  }
  if (dateRange === 'custom' && parseDateInput(customStartDate) && parseDateInput(customEndDate)) {
    return { from: customStartDate, to: customEndDate };
  }

  const validDates = availableDates
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => a - b);
  return {
    from: validDates.length ? toDateInputValue(validDates[0]) : toDateInputValue(now),
    to: toDateInputValue(now),
  };
};

export const validateReportExportRange = ({ from, to, now = new Date() } = {}) => {
  if (!from) return 'From date is required.';
  if (!to) return 'To date is required.';
  const start = parseDateInput(from);
  const end = parseDateInput(to, { endOfDay: true });
  if (!start || !end) return 'Enter a valid export date range.';
  if (start > end) return 'From date must not be after To date.';
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (start > todayEnd || end > todayEnd) return 'Export dates cannot be in the future.';
  return '';
};

export const isDateWithinReportExportRange = (value, { from, to } = {}) => {
  const date = new Date(value);
  const start = parseDateInput(from);
  const end = parseDateInput(to, { endOfDay: true });
  return !Number.isNaN(date.getTime()) && Boolean(start && end && date >= start && date <= end);
};

export const formatReportExportRangeLabel = ({ from, to } = {}) => {
  const start = parseDateInput(from);
  const end = parseDateInput(to);
  if (!start || !end) return 'Selected date range';
  const format = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return from === to ? format(start) : `${format(start)} to ${format(end)}`;
};

export const getReportExportFilenameRange = ({ from, to } = {}) => (
  parseDateInput(from) && parseDateInput(to) ? `${from}_to_${to}` : toDateInputValue(new Date())
);
