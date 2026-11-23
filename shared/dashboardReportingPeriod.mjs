const DAY = 86400000;
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });

export const getDashboardBusinessDate = (now = new Date()) => {
  const parts = Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const parseDay = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00+08:00`);
  return Number.isFinite(+parsed) && getDashboardBusinessDate(parsed) === value ? parsed : null;
};

// Keep the rolling "This Week" window to exactly seven Manila calendar dates, including today.
// Date-only inputs always describe Manila calendar days, regardless of host TZ.
export const getDashboardReportingPeriod = ({ dateRange = 'week', specificDate = '', customStartDate = '', customEndDate = '' } = {}, now = new Date()) => {
  const todayText = getDashboardBusinessDate(now);
  const today = parseDay(todayText);
  let start;
  let end;
  if (dateRange === 'today') { start = today; end = new Date(+today + DAY); }
  else if (dateRange === 'week') { start = new Date(+today - 6 * DAY); end = new Date(+today + DAY); }
  else if (dateRange === 'month') {
    start = parseDay(`${todayText.slice(0, 7)}-01`);
    const [year, month] = todayText.split('-').map(Number);
    end = new Date(Date.UTC(year, month, 1) - 8 * 3600000);
  } else if (dateRange === 'year') {
    start = parseDay(`${todayText.slice(0, 4)}-01-01`);
    end = parseDay(`${Number(todayText.slice(0, 4)) + 1}-01-01`);
  } else if (dateRange === 'specific_date') {
    start = parseDay(specificDate);
    if (start) end = new Date(+start + DAY);
  } else if (dateRange === 'custom') {
    start = parseDay(customStartDate);
    const lastDay = parseDay(customEndDate);
    if (lastDay && start && lastDay >= start) end = new Date(+lastDay + DAY);
  }
  if (!start || !end) return null;
  return { dateRange, start: start.toISOString(), end: end.toISOString(), timeZone: 'Asia/Manila', endExclusive: true };
};
