const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MANILA_OFFSET_IN_MS = 8 * 60 * 60 * 1000;
const manilaDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});

const parseDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getManilaParts = (value) => {
  const date = parseDate(value);
  if (!date) return null;
  const parts = Object.fromEntries(manilaDateFormatter.formatToParts(date).map(({ type, value: partValue }) => [type, partValue]));
  const result = {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: Number(parts.fractionalSecond),
  };
  return Object.values(result).every(Number.isInteger) ? result : null;
};

const createUtcDate = (year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date;
};

const getManilaCalendarDayNumber = (value) => {
  const parts = getManilaParts(value);
  if (!parts) return null;
  return Math.floor(createUtcDate(parts.year, parts.month, parts.day).getTime() / DAY_IN_MS);
};

const startOfManilaCalendarDay = (value) => {
  const dayNumber = getManilaCalendarDayNumber(value);
  return dayNumber === null ? null : new Date((dayNumber * DAY_IN_MS) - MANILA_OFFSET_IN_MS);
};

const addManilaCalendarDays = (value, days) => {
  const parts = getManilaParts(value);
  const dayCount = Number(days);
  if (!parts || !Number.isSafeInteger(dayCount)) return null;
  // Manila has a fixed UTC+08:00 offset; shift the Manila wall-calendar date,
  // then convert that wall time back to its UTC instant without host-local APIs.
  return createUtcDate(
    parts.year,
    parts.month,
    parts.day + dayCount,
    parts.hour - 8,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
};

module.exports = {
  getManilaCalendarDayNumber,
  startOfManilaCalendarDay,
  addManilaCalendarDays,
};
