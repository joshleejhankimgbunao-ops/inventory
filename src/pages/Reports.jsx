import React, { useState, useMemo, useEffect } from 'react';
import { showToast } from '../utils/toastHelper';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/StatCard';
import { listCreditTransactionsApi } from '../services/inventoryApi';
import { formatCurrency, formatNumber } from '../utils/numberFormat';
import logo from '../assets/logo.png';
import ColoredPiePercentageLabel from '../components/ColoredPiePercentageLabel';
import { ANALYTICS_PIE_COLORS } from '../utils/analyticsChart';
import MetricTrendLine from '../components/MetricTrendLine';
import ReportDateRangeSelector from '../components/ReportDateRangeSelector';
import ReportsDateSelector from '../components/ReportsDateSelector';
import { getDashboardComparisonPeriod, getMetricTrend, getPreviousSalesReportMetrics } from '../utils/dashboardTrend';
import { getValidSales, isValidCreditCollectionForReporting } from '../../shared/saleLifecycle.mjs';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import {
  formatReportExportRangeLabel,
  getDefaultReportExportRange,
  getReportExportFilenameRange,
  isDateWithinReportExportRange,
  toDateInputValue,
  validateReportExportRange,
} from '../utils/reportExportRange';

const loadPdfLogo = (source) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Unable to prepare the company logo for the PDF.'));
      return;
    }

    context.drawImage(image, 0, 0);
    resolve({
      dataUrl: canvas.toDataURL('image/png'),
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  };
  image.onerror = () => reject(new Error('Unable to load the company logo for the PDF.'));
  image.src = source;
});

const TopSellingProductsTooltip = ({ active, payload, showFinancials }) => {
  if (!active || !payload?.length) {
    return null;
  }

  const product = payload[0]?.payload;
  const quantity = Number(product?.value || 0);
  const percentage = Number(product?.percentage || 0);
  const revenue = Number(product?.revenue || 0);
  const revenueLabel = showFinancials
    ? formatCurrency(revenue)
    : 'P••••••';

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs font-semibold text-gray-900">{product?.name || 'Unknown product'}</p>
      <p className="text-xs text-gray-700">Quantity: {formatNumber(quantity)} units ({percentage.toFixed(0)}%)</p>
      <p className="text-xs text-gray-700">Total Sales: {revenueLabel}</p>
    </div>
  );
};

const SalesByCategoryTooltip = ({ active, payload, showFinancials }) => {
  if (!active || !payload?.length) {
    return null;
  }

  const category = payload[0]?.payload;
  const percentage = Number(category?.percentage || 0);
  const salesLabel = showFinancials
    ? formatCurrency(Number(category?.value || 0))
    : 'Pâ€¢â€¢â€¢â€¢â€¢â€¢';

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs font-semibold text-gray-900">{category?.name || 'Uncategorized'}</p>
      <p className="text-xs text-gray-700">Contribution: {percentage.toFixed(1)}%</p>
      <p className="text-xs text-gray-700">Sales: {salesLabel}</p>
    </div>
  );
};

const EmptyAnalyticsState = ({ title, subtitle, icon }) => (
  <div className="h-full w-full flex items-center justify-center p-4">
    <div className="w-full max-w-md px-4 py-6 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full text-gray-500">
        {icon}
      </div>
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
    </div>
  </div>
);

const FinancialStatCard = ({ title, value, hiddenValue, showFinancials, onToggle, icon, subtitle }) => (
  <div className="relative h-full overflow-hidden rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg group">
    <div className="flex items-center justify-between">
      <div className="min-w-0">
        <h3 className="mb-1.5 text-[13px] font-medium normal-case tracking-normal text-gray-500 transition-colors group-hover:text-gray-900">{title}</h3>
        <div className="text-[21px] font-semibold leading-tight tracking-tight text-gray-900">{showFinancials ? value : hiddenValue}</div>
        {subtitle && <p className="mt-0.5 text-[11px] font-medium leading-tight text-gray-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-colors"
          aria-label={showFinancials ? 'Hide financial values' : 'Show financial values'}
          title={showFinancials ? 'Hide financial values' : 'Show financial values'}
        >
          {showFinancials ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          )}
        </button>
        <div className="p-3 rounded-xl bg-gray-900 text-white shadow-sm group-hover:scale-110 transition-transform duration-300">
          {icon}
        </div>
      </div>
    </div>
  </div>
);

const Reports = () => {
  const { transactions = [], processedInventory: inventory = [] } = useInventory() || {};
  const { userRole, ROLES } = useAuth();

  const [dateRange, setDateRange] = useState('week');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [specificDate, setSpecificDate] = useState('');
  const [reportType, setReportType] = useState('sales');
  const [exportType, setExportType] = useState('sales');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportFormat, setExportFormat] = useState('pdf');
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exportRangeError, setExportRangeError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [showFinancials, setShowFinancials] = useState(true);
  const [creditTransactions, setCreditTransactions] = useState([]);
  const [isCompactPieChart, setIsCompactPieChart] = useState(false);
  const isAdminInventoryOnly = userRole === ROLES.ADMIN;

  useEffect(() => {
    if (isAdminInventoryOnly && reportType !== 'inventory') {
      setReportType('inventory');
    }
  }, [isAdminInventoryOnly, reportType]);

  useEffect(() => {
    if (isAdminInventoryOnly && exportType !== 'inventory') {
      setExportType('inventory');
    }
  }, [isAdminInventoryOnly, exportType]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const updateChartLayout = () => setIsCompactPieChart(mediaQuery.matches);

    updateChartLayout();
    mediaQuery.addEventListener('change', updateChartLayout);
    return () => mediaQuery.removeEventListener('change', updateChartLayout);
  }, []);

  useEffect(() => {
    if (!showExportMenu) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isExporting) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showExportMenu, isExporting]);

  useEffect(() => {
    let mounted = true;

    const loadCreditTransactions = async () => {
      try {
        const rows = await listCreditTransactionsApi({ status: 'All' });
        if (mounted) {
          setCreditTransactions(Array.isArray(rows) ? rows : []);
        }
      } catch {
        if (mounted) {
          setCreditTransactions([]);
        }
      }
    };

    loadCreditTransactions();
    const unsubscribeSale = subscribeRealtimeEvent('sale.updated', loadCreditTransactions);
    const unsubscribeCredit = subscribeRealtimeEvent('credit-transactions.updated', loadCreditTransactions);

    return () => {
      mounted = false;
      unsubscribeSale();
      unsubscribeCredit();
    };
  }, []);

  const filteredTransactions = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return getValidSales(transactions).filter((t) => {
      const tDate = new Date(t.date);

      if (dateRange === 'today') return tDate >= today;
      if (dateRange === 'week') {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return tDate >= weekAgo;
      }
      if (dateRange === 'year') {
        return tDate.getFullYear() === today.getFullYear();
      }
      if (dateRange === 'month') {
        return tDate.getFullYear() === today.getFullYear() && tDate.getMonth() === today.getMonth();
      }
      if (dateRange === 'custom' && customStartDate && customEndDate) {
        const s = new Date(customStartDate);
        const e = new Date(customEndDate);
        e.setHours(23, 59, 59, 999);
        return tDate >= s && tDate <= e;
      }
      if (dateRange === 'specific_date' && specificDate) {
        const s = new Date(specificDate);
        const e = new Date(specificDate);
        e.setHours(23, 59, 59, 999);
        return tDate >= s && tDate <= e;
      }

      return true;
    });
  }, [transactions, dateRange, customStartDate, customEndDate, specificDate]);

  const filteredCreditPaymentEvents = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const inRange = (rawDate) => {
      const tDate = new Date(rawDate);
      if (Number.isNaN(tDate.getTime())) return false;

      if (dateRange === 'today') return tDate >= today;
      if (dateRange === 'week') {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return tDate >= weekAgo;
      }
      if (dateRange === 'year') {
        return tDate.getFullYear() === today.getFullYear();
      }
      if (dateRange === 'month') {
        return tDate.getFullYear() === today.getFullYear() && tDate.getMonth() === today.getMonth();
      }
      if (dateRange === 'custom' && customStartDate && customEndDate) {
        const s = new Date(customStartDate);
        const e = new Date(customEndDate);
        e.setHours(23, 59, 59, 999);
        return tDate >= s && tDate <= e;
      }
      if (dateRange === 'specific_date' && specificDate) {
        const s = new Date(specificDate);
        const e = new Date(specificDate);
        e.setHours(23, 59, 59, 999);
        return tDate >= s && tDate <= e;
      }

      return true;
    };

    return (creditTransactions || []).filter(isValidCreditCollectionForReporting).flatMap((creditRow) => (
      (creditRow?.paymentHistory || [])
        .filter((payment) => inRange(payment?.paymentDate))
        .map((payment) => ({
          date: payment?.paymentDate,
          amount: Number(payment?.amount || 0),
        }))
    ));
  }, [creditTransactions, dateRange, customStartDate, customEndDate, specificDate]);

  const availableExportDates = useMemo(() => [
    ...getValidSales(transactions).map((transaction) => transaction?.date),
    ...(creditTransactions || [])
      .filter(isValidCreditCollectionForReporting)
      .flatMap((creditRow) => (creditRow?.paymentHistory || []).map((payment) => payment?.paymentDate)),
  ].filter(Boolean), [transactions, creditTransactions]);

  const exportRange = useMemo(() => ({ from: exportStartDate, to: exportEndDate }), [exportStartDate, exportEndDate]);

  const exportTransactions = useMemo(() => getValidSales(transactions).filter((transaction) => (
    isDateWithinReportExportRange(transaction?.date, exportRange)
  )), [transactions, exportRange]);

  const exportCreditPaymentEvents = useMemo(() => (
    (creditTransactions || [])
      .filter(isValidCreditCollectionForReporting)
      .flatMap((creditRow) => (creditRow?.paymentHistory || [])
        .filter((payment) => isDateWithinReportExportRange(payment?.paymentDate, exportRange))
        .map((payment) => ({ date: payment?.paymentDate, amount: Number(payment?.amount || 0) })))
  ), [creditTransactions, exportRange]);

  const exportCollectedRevenue = useMemo(() => (
    exportTransactions
      .filter((transaction) => String(transaction?.paymentMethod || '').toLowerCase() !== 'credit')
      .reduce((sum, transaction) => sum + Number(transaction.total || 0), 0)
    + exportCreditPaymentEvents.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  ), [exportTransactions, exportCreditPaymentEvents]);
  const exportOrderCount = exportTransactions.length;
  const exportItemsSold = useMemo(() => exportTransactions.reduce(
    (sum, transaction) => sum + (transaction.items?.reduce((itemSum, item) => itemSum + Number(item.qty || 0), 0) || 0),
    0
  ), [exportTransactions]);

  // Actual money received in the selected period: immediate-payment sales on
  // their sale date plus Credit payments on their payment date.
  const totalCollectedRevenue =
    filteredTransactions
      .filter((t) => String(t?.paymentMethod || '').toLowerCase() !== 'credit')
      .reduce((s, t) => s + (t.total || 0), 0)
    + filteredCreditPaymentEvents.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const totalOrders = filteredTransactions.length;
  const totalItemsSold = filteredTransactions.reduce(
    (sum, transaction) => sum + (transaction.items?.reduce((itemSum, item) => itemSum + (item.qty || 0), 0) || 0),
    0
  );
  const comparisonPeriod = useMemo(() => getDashboardComparisonPeriod({
    dateRange,
    customStartDate,
    customEndDate,
    specificDate,
  }), [dateRange, customStartDate, customEndDate, specificDate]);
  const previousSalesMetrics = useMemo(() => (
    comparisonPeriod
      ? getPreviousSalesReportMetrics(transactions, creditTransactions, comparisonPeriod)
      : { collectedRevenue: 0, orders: 0, items: 0 }
  ), [transactions, creditTransactions, comparisonPeriod]);
  const collectedRevenueTrend = useMemo(() => getMetricTrend(totalCollectedRevenue, previousSalesMetrics.collectedRevenue), [totalCollectedRevenue, previousSalesMetrics.collectedRevenue]);
  const totalOrdersTrend = useMemo(() => getMetricTrend(totalOrders, previousSalesMetrics.orders), [totalOrders, previousSalesMetrics.orders]);
  const itemsSoldTrend = useMemo(() => getMetricTrend(totalItemsSold, previousSalesMetrics.items), [totalItemsSold, previousSalesMetrics.items]);

  const topProducts = useMemo(() => {
    const inventoryNameByCode = new Map(
      inventory
        .filter((item) => item?.code)
        .map((item) => [item.code, item.name])
    );

    const stats = {};
    filteredTransactions.forEach((t) => {
      t.items?.forEach((it) => {
        const canonicalName = inventoryNameByCode.get(it.code) || it.name;
        if (!stats[it.code]) stats[it.code] = { code: it.code, name: canonicalName, qty: 0, revenue: 0 };
        stats[it.code].qty += it.qty || 0;
        stats[it.code].revenue += (it.price || 0) * (it.qty || 0);
      });
    });
    return Object.values(stats).sort((a, b) => b.revenue - a.revenue);
  }, [filteredTransactions, inventory]);

  const topProductsPieData = useMemo(() => {
    const topItems = topProducts.slice(0, 10);
    const totalQuantity = topItems.reduce((sum, product) => sum + (product.qty || 0), 0);

    return topItems.map((product) => ({
      name: product.name,
      value: product.qty,
      revenue: product.revenue,
      percentage: totalQuantity > 0 ? (product.qty / totalQuantity) * 100 : 0,
    }));
  }, [topProducts]);

  // Keep category revenue aligned with the Dashboard: transaction item price × quantity,
  // resolved against the current inventory category when available.
  const salesByCategory = useMemo(() => {
    const inventoryByCode = new Map(inventory.map((item) => [item.code, item]));
    const categoryTotals = new Map();

    filteredTransactions.forEach((transaction) => {
      (transaction.items || []).forEach((item) => {
        const price = Number(item.price || 0);
        const quantity = Number(item.qty || 0);
        const revenue = price * quantity;
        const inventoryItem = inventoryByCode.get(item.code) || {};
        const category = String(inventoryItem.category || item.category || 'Uncategorized').trim() || 'Uncategorized';

        categoryTotals.set(category, (categoryTotals.get(category) || 0) + revenue);
      });
    });

    const totalSales = Array.from(categoryTotals.values()).reduce((sum, value) => sum + value, 0);

    return Array.from(categoryTotals.entries())
      .map(([name, value]) => ({
        name,
        value,
        percentage: totalSales > 0 ? (value / totalSales) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTransactions, inventory]);

  const trendData = useMemo(() => {
    const getGranularity = () => {
      if (dateRange === 'year') return 'month';
      if (dateRange === 'all') return 'year';

      if (dateRange === 'custom' && customStartDate && customEndDate) {
        const start = new Date(customStartDate);
        const end = new Date(customEndDate);
        const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        return diffDays > 90 ? 'month' : 'day';
      }

      return 'day';
    };

    const granularity = getGranularity();
    const buckets = {};

    const getBucket = (rawDate) => {
      const dateObj = new Date(rawDate);

      if (granularity === 'year') {
        return {
          key: `${dateObj.getFullYear()}`,
          label: `${dateObj.getFullYear()}`,
          sortValue: new Date(dateObj.getFullYear(), 0, 1).getTime(),
        };
      }

      if (granularity === 'month') {
        const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        return {
          key,
          label: dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          sortValue: new Date(dateObj.getFullYear(), dateObj.getMonth(), 1).getTime(),
        };
      }

      const key = dateObj.toISOString().split('T')[0];
      return {
        key,
        label: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        sortValue: new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()).getTime(),
      };
    };

    filteredTransactions
      .filter((transaction) => String(transaction?.paymentMethod || '').toLowerCase() !== 'credit')
      .forEach((transaction) => {
      const bucket = getBucket(transaction.date);

      if (!buckets[bucket.key]) {
        buckets[bucket.key] = {
          dateKey: bucket.key,
          name: bucket.label,
          sales: 0,
          orders: 0,
          sortValue: bucket.sortValue,
        };
      }

      buckets[bucket.key].sales += transaction.total || 0;
      buckets[bucket.key].orders += 1;
    });

    filteredCreditPaymentEvents.forEach((payment) => {
      const bucket = getBucket(payment.date);

      if (!buckets[bucket.key]) {
        buckets[bucket.key] = {
          dateKey: bucket.key,
          name: bucket.label,
          sales: 0,
          orders: 0,
          sortValue: bucket.sortValue,
        };
      }

      buckets[bucket.key].sales += Number(payment.amount || 0);
    });

    return Object.values(buckets).sort((a, b) => a.sortValue - b.sortValue);
  }, [filteredTransactions, filteredCreditPaymentEvents, dateRange, customStartDate, customEndDate]);

  const exportTrendData = useMemo(() => {
    const start = new Date(`${exportStartDate}T00:00:00`);
    const end = new Date(`${exportEndDate}T23:59:59`);
    const spanDays = Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
      ? 0
      : Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    const granularity = spanDays > 730 ? 'year' : spanDays > 90 ? 'month' : 'day';
    const buckets = {};
    const getBucket = (rawDate) => {
      const dateObj = new Date(rawDate);
      if (granularity === 'year') {
        return { key: `${dateObj.getFullYear()}`, label: `${dateObj.getFullYear()}`, sortValue: new Date(dateObj.getFullYear(), 0, 1).getTime() };
      }
      if (granularity === 'month') {
        const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        return { key, label: dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), sortValue: new Date(dateObj.getFullYear(), dateObj.getMonth(), 1).getTime() };
      }
      const key = toDateInputValue(dateObj);
      return { key, label: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), sortValue: new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()).getTime() };
    };
    const addToBucket = (rawDate, sales, orders) => {
      const bucket = getBucket(rawDate);
      if (!buckets[bucket.key]) buckets[bucket.key] = { dateKey: bucket.key, name: bucket.label, sales: 0, orders: 0, sortValue: bucket.sortValue };
      buckets[bucket.key].sales += Number(sales || 0);
      buckets[bucket.key].orders += Number(orders || 0);
    };
    exportTransactions
      .filter((transaction) => String(transaction?.paymentMethod || '').toLowerCase() !== 'credit')
      .forEach((transaction) => addToBucket(transaction.date, transaction.total, 1));
    exportCreditPaymentEvents.forEach((payment) => addToBucket(payment.date, payment.amount, 0));
    return Object.values(buckets).sort((a, b) => a.sortValue - b.sortValue);
  }, [exportTransactions, exportCreditPaymentEvents, exportStartDate, exportEndDate]);

  const inventoryValue = inventory.reduce((s, i) => s + ((i.stock || 0) * (i.price || 0)), 0);
  const lowStockCount = inventory.filter((i) => (i.stock || 0) <= 10).length;
  const outOfStockCount = inventory.filter((i) => (i.stock || 0) === 0).length;

  const openExportModal = () => {
    const initialRange = getDefaultReportExportRange({
      dateRange,
      customStartDate,
      customEndDate,
      specificDate,
      availableDates: availableExportDates,
    });
    setExportStartDate(initialRange.from);
    setExportEndDate(initialRange.to);
    setExportRangeError('');
    setExportType(isAdminInventoryOnly ? 'inventory' : reportType);
    setShowExportMenu(true);
  };

  const closeExportModal = () => {
    if (isExporting) return;
    setShowExportMenu(false);
    setExportRangeError('');
  };

  const updateExportRange = ({ from, to }) => {
    setExportStartDate(from);
    setExportEndDate(to);
    setExportRangeError('');
  };

  const exportPeriodLabel = () => formatReportExportRangeLabel(exportRange);
  const exportFilenameRange = () => getReportExportFilenameRange(exportRange);

  const salesDetailRows = () => exportTransactions.map((transaction) => ([
    transaction.id || '-',
    transaction.date ? new Date(transaction.date) : '',
    transaction.customerName || transaction.customer || '-',
    (transaction.items || []).map((item) => `${item.name || item.code || 'Item'} x${Number(item.qty || 0)}`).join('; '),
    Number((transaction.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0)),
    transaction.paymentMethod || '-',
    Number(transaction.total || 0),
  ]));

  const inventoryDetailRows = () => inventory.map((item) => ([
    item.code || '-', item.name || '-', item.category || '-', Number(item.stock || 0), Number(item.price || 0), Number(item.stock || 0) * Number(item.price || 0),
  ]));

  const handleExportExcel = (mode = exportType) => {
    const filenameRange = exportFilenameRange();
    const workbook = XLSX.utils.book_new();
    const generated = new Date();
    const salesRows = salesDetailRows();
    const inventoryRows = inventoryDetailRows();

    const appendSheet = (name, summaryRows, headers, rows, currencyColumns = []) => {
      const sheet = XLSX.utils.aoa_to_sheet([...summaryRows, [], headers, ...rows]);
      const headerRow = summaryRows.length + 2;
      sheet['!cols'] = headers.map((header, index) => ({ wch: Math.min(42, Math.max(header.length + 2, index === 3 ? 34 : 14)) }));
      sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headerRow - 1, c: 0 }, e: { r: headerRow - 1 + rows.length, c: headers.length - 1 } }) };
      sheet['!freeze'] = { xSplit: 0, ySplit: headerRow };
      headers.forEach((_, index) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: headerRow - 1, c: index })];
        if (cell) cell.s = { font: { bold: true } };
      });
      rows.forEach((_, rowIndex) => currencyColumns.forEach((columnIndex) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: headerRow + rowIndex, c: columnIndex })];
        if (cell) cell.z = '[$₱-340]#,##0.00';
      }));
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };

    if (mode === 'sales' || mode === 'combined') {
      appendSheet('Sales Summary', [
        ['Company', 'Tableria La Confianza Co., Inc.'], ['Reporting Period', exportPeriodLabel()], ['Generated', generated],
        ['Collected Revenue', Number(exportCollectedRevenue)], ['Total Orders', Number(exportOrderCount)], ['Items Sold', Number(exportItemsSold)],
      ], ['Transaction ID', 'Date', 'Customer', 'Items', 'Quantity', 'Payment Method', 'Amount'], salesRows, [6]);
      const salesData = XLSX.utils.aoa_to_sheet([['Transaction ID', 'Date', 'Customer', 'Items', 'Quantity', 'Payment Method', 'Amount'], ...salesRows]);
      salesData['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 22 }, { wch: 42 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
      salesData['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: salesRows.length, c: 6 } }) };
      salesData['!freeze'] = { xSplit: 0, ySplit: 1 };
      XLSX.utils.book_append_sheet(workbook, salesData, 'Sales Data');
    }
    if (mode === 'inventory' || mode === 'combined') {
      appendSheet('Inventory Summary', [
        ['Company', 'Tableria La Confianza Co., Inc.'], ['Generated', generated], ['Total Products', Number(inventory.length)],
        ['Low Stock Items', Number(lowStockCount)], ['Out of Stock Items', Number(outOfStockCount)], ['Inventory Value', Number(inventoryValue)],
      ], ['SKU', 'Product', 'Category', 'Stock', 'Price', 'Inventory Value'], inventoryRows, [4, 5]);
      const inventoryData = XLSX.utils.aoa_to_sheet([['SKU', 'Product', 'Category', 'Stock', 'Price', 'Inventory Value'], ...inventoryRows]);
      inventoryData['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 20 }, { wch: 10 }, { wch: 14 }, { wch: 18 }];
      inventoryData['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: inventoryRows.length, c: 5 } }) };
      inventoryData['!freeze'] = { xSplit: 0, ySplit: 1 };
      XLSX.utils.book_append_sheet(workbook, inventoryData, 'Inventory Data');
    }
    XLSX.writeFile(workbook, `${mode}_report_${filenameRange}.xlsx`);
  };

  const handleDownloadPDF = async (mode = exportType) => {
    let pdfLogo = null;
    try {
      pdfLogo = await loadPdfLogo(logo);
    } catch (error) {
      console.warn('Report PDF logo could not be loaded; continuing with a text-only header.', error);
    }

    const pdf = new jsPDF('p', 'mm', 'a4');
    const margin = 14;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const printableWidth = pageWidth - (margin * 2);
    const filenameRange = exportFilenameRange();
    const formatPdfCurrency = (value) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let tableY = 14;
    const addHeader = (title, includePeriod = false) => {
      const headerY = tableY;
      const maximumLogoSize = 20;
      const logoRatio = pdfLogo?.width && pdfLogo?.height ? pdfLogo.width / pdfLogo.height : 1;
      const logoWidth = Math.min(maximumLogoSize, maximumLogoSize * logoRatio);
      const logoHeight = logoWidth / logoRatio;
      const contentX = pdfLogo ? margin + logoWidth + 5 : margin;

      if (pdfLogo) {
        pdf.addImage(pdfLogo.dataUrl, 'PNG', margin, headerY, logoWidth, logoHeight);
      }

      pdf.setTextColor(17, 24, 39);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.text('Tableria La Confianza Co., Inc.', contentX, headerY + 5);
      pdf.setFontSize(11);
      pdf.text(title, contentX, headerY + 11);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      let metadataY = headerY + 16;
      if (includePeriod) {
        pdf.text(`Reporting Period: ${exportPeriodLabel()}`, contentX, metadataY);
        metadataY += 5;
      }
      pdf.text(`Generated: ${new Date().toLocaleString()}`, contentX, metadataY);
      tableY = Math.max(headerY + (pdfLogo ? logoHeight : 0), metadataY) + 7;
    };
    const addSection = (title) => { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text(title, margin, tableY); tableY += 4; };
    const addTable = (head, body, options = {}) => {
      autoTable(pdf, {
        startY: tableY,
        margin: { left: margin, right: margin },
        tableWidth: printableWidth,
        head: [head],
        body: body.length ? body : [['No records available.']],
        theme: 'grid',
        styles: { fontSize: 7.25, cellPadding: { top: 2.1, right: 3.2, bottom: 2.1, left: 2.7 }, lineColor: [229, 231, 235], lineWidth: 0.15, textColor: [31, 41, 55], overflow: 'linebreak' },
        headStyles: { fillColor: [17, 24, 39], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        ...options,
      });
      tableY = pdf.lastAutoTable.finalY + 8;
    };
    const addSalesTables = () => {
      addSection('SALES SUMMARY');
      addTable(['Collected Revenue (PHP)', 'Total Orders', 'Items Sold'], [[formatPdfCurrency(exportCollectedRevenue), String(exportOrderCount), String(exportItemsSold)]], { columnStyles: { 0: { cellWidth: printableWidth / 3, halign: 'right' }, 1: { cellWidth: printableWidth / 3, halign: 'center' }, 2: { cellWidth: printableWidth / 3, halign: 'center' } } });
      addSection('COLLECTIONS ANALYTICS');
      addTable(['Date', 'Collected Revenue (PHP)', 'Orders'], exportTrendData.map((item) => [item.name, formatPdfCurrency(item.sales), String(item.orders)]), { columnStyles: { 0: { cellWidth: 53, halign: 'left' }, 1: { cellWidth: 88, halign: 'right' }, 2: { cellWidth: 41, halign: 'center' } } });
      addSection('SALES DETAILS');
      addTable(['Transaction ID', 'Date', 'Items', 'Payment', 'Amount (PHP)'], salesDetailRows().map((row) => [row[0], row[1] ? new Date(row[1]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-', row[3], row[5], formatPdfCurrency(row[6])]), { columnStyles: { 0: { cellWidth: 33, halign: 'left' }, 1: { cellWidth: 27, halign: 'left' }, 2: { cellWidth: 66, halign: 'left' }, 3: { cellWidth: 25, halign: 'center' }, 4: { cellWidth: 31, halign: 'right' } } });
    };
    const addInventoryTables = () => {
      addSection('INVENTORY SUMMARY');
      addTable(['Total Products', 'Low Stock Items', 'Out of Stock', 'Inventory Value (PHP)'], [[String(inventory.length), String(lowStockCount), String(outOfStockCount), formatPdfCurrency(inventoryValue)]], { columnStyles: { 0: { cellWidth: 45.5, halign: 'center' }, 1: { cellWidth: 45.5, halign: 'center' }, 2: { cellWidth: 45.5, halign: 'center' }, 3: { cellWidth: 45.5, halign: 'right' } } });
      addSection('INVENTORY DETAILS');
      addTable(['SKU', 'Product', 'Category', 'Stock', 'Price (PHP)', 'Inventory Value (PHP)'], inventoryDetailRows().map((row) => [row[0], row[1], row[2], String(row[3]), formatPdfCurrency(row[4]), formatPdfCurrency(row[5])]), { columnStyles: { 0: { cellWidth: 28, halign: 'left' }, 1: { cellWidth: 48, halign: 'left' }, 2: { cellWidth: 34, halign: 'left' }, 3: { cellWidth: 16, halign: 'center' }, 4: { cellWidth: 25, halign: 'right' }, 5: { cellWidth: 31, halign: 'right' } } });
    };
    addHeader(mode === 'combined' ? 'COMBINED SALES & INVENTORY REPORT' : `${mode.toUpperCase()} REPORT`, mode !== 'inventory');
    if (mode === 'sales' || mode === 'combined') addSalesTables();
    if (mode === 'combined') { pdf.addPage(); tableY = 16; addSection('INVENTORY REPORT'); }
    if (mode === 'inventory' || mode === 'combined') addInventoryTables();
    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) { pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(107, 114, 128); pdf.text(`Page ${page} of ${pages}`, pageWidth - margin - 22, pdf.internal.pageSize.getHeight() - 8); }
    pdf.save(`${mode}_report_${filenameRange}.pdf`);
  };

  const runExport = async (format = exportFormat) => {
    const rangeError = validateReportExportRange(exportRange);
    if (rangeError) {
      setExportRangeError(rangeError);
      return;
    }
    const mode = isAdminInventoryOnly ? 'inventory' : exportType;
    const hasSalesData = exportTransactions.length > 0 || exportCreditPaymentEvents.length > 0;
    const hasInventoryData = inventory.length > 0;
    if ((mode === 'sales' && !hasSalesData)
      || (mode === 'inventory' && !hasInventoryData)
      || (mode === 'combined' && !hasSalesData && !hasInventoryData)) {
      showToast('No Data', 'There is no data available for the selected export range.', 'warning', 'export-empty');
      return;
    }
    setExportRangeError('');
    setIsExporting(true);
    try {
      if (format === 'pdf') await handleDownloadPDF(mode);
      else handleExportExcel(mode);
      showToast('Export Ready', `${mode === 'combined' ? 'Combined' : mode === 'sales' ? 'Sales' : 'Inventory'} ${format === 'pdf' ? 'PDF' : 'Excel workbook'} downloaded.`, 'download', `export-${format}`);
      setShowExportMenu(false);
    } catch (error) {
      showToast('Export Failed', error?.message || 'Unable to generate the report.', 'error', `export-${format}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
        <div className="flex h-auto flex-col gap-2 md:h-full">
    <div id="report-container" className="relative flex flex-col bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300 p-4 md:min-h-0 md:flex-1">
      <div className="flex flex-col gap-3 md:min-h-0 md:flex-1">
        <div className="flex flex-col gap-4 shrink-0 border-b border-gray-200 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            
            <div className="shrink-0">
              <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Reports</p>
              <p className="text-gray-500 font-medium text-[11px] md:text-xs mt-1">
                {isAdminInventoryOnly ? 'View inventory status' : 'View sales, collections, and inventory performance'}
              </p>
            </div>

            <div className="flex flex-col items-start sm:items-end gap-2 w-full sm:w-auto">
              {!isAdminInventoryOnly ? (
                <div className="analytics-tabs inline-flex rounded-lg bg-gray-100 p-1 self-start sm:self-end shrink-0">
                  <button type="button" onClick={() => { setReportType('sales'); setShowExportMenu(false); }} className={`analytics-tab rounded-md border border-transparent px-3 py-1 text-xs font-semibold transition-colors ${reportType === 'sales' ? 'analytics-tab-active bg-gray-900 text-white' : 'analytics-tab-inactive text-gray-700'}`}>Sales</button>
                  <button type="button" onClick={() => { setReportType('inventory'); setShowExportMenu(false); }} className={`analytics-tab rounded-md border border-transparent px-3 py-1 text-xs font-semibold transition-colors ${reportType === 'inventory' ? 'analytics-tab-active bg-gray-900 text-white' : 'analytics-tab-inactive text-gray-700'}`}>Inventory</button>
                </div>
              ) : (
                <div className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 self-start sm:self-end shrink-0">
                  Inventory Only
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <ReportsDateSelector
                  value={dateRange}
                  onChange={setDateRange}
                  specificDate={specificDate}
                  onSpecificDateChange={setSpecificDate}
                  customStartDate={customStartDate}
                  onCustomStartDateChange={setCustomStartDate}
                  customEndDate={customEndDate}
                  onCustomEndDateChange={setCustomEndDate}
                />

                <div className="pdf-exclude shrink-0">
                  <button
                    type="button"
                    onClick={openExportModal}
                    className="inline-flex h-8 items-center justify-center rounded-lg bg-gray-900 px-2.5 text-xs font-medium text-white transition-colors hover:bg-gray-800 active:bg-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500/40 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900"
                    aria-label="Export"
                  >
                    <span>Export</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className={`grid auto-rows-fr shrink-0 gap-3 ${reportType === 'inventory' ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
          {reportType === 'sales' ? (
            <>
              <FinancialStatCard
                title="Collected Revenue"
                value={formatCurrency(totalCollectedRevenue)}
                hiddenValue="P ••••••"
                showFinancials={showFinancials}
                onToggle={() => setShowFinancials((prev) => !prev)}
                subtitle={comparisonPeriod ? <MetricTrendLine trend={collectedRevenueTrend} label={comparisonPeriod.label} formatDelta={formatCurrency} /> : null}
                icon={(
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              />

              <StatCard
                title="Total Orders"
                value={totalOrders}
                subtitle={comparisonPeriod ? <MetricTrendLine trend={totalOrdersTrend} label={comparisonPeriod.label} formatDelta={formatNumber} unit=" orders" /> : null}
                subtitleClassName="whitespace-nowrap"
                icon={(
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z" />
                  </svg>
                )}
                metricHierarchy
                titleClassName="text-[13px]"
                valueClassName="text-[21px] leading-tight"
              />

              <StatCard
                title="Items Sold"
                value={totalItemsSold}
                subtitle={comparisonPeriod ? <MetricTrendLine trend={itemsSoldTrend} label={comparisonPeriod.label} formatDelta={formatNumber} unit=" items" /> : null}
                subtitleClassName="whitespace-nowrap"
                icon={(
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-1.2 6.4a1 1 0 00.98 1.2H19M9 21a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z" />
                  </svg>
                )}
                metricHierarchy
                titleClassName="text-[13px]"
                valueClassName="text-[21px] leading-tight"
              />
            </>
          ) : (
            <>
              <StatCard
                title="Total Products"
                value={inventory.length}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
                metricHierarchy
                titleClassName="text-[13px]"
                valueClassName="text-[21px] leading-tight"
              />

              <StatCard
                title="Low Stock Items"
                value={lowStockCount}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
                metricHierarchy
                titleClassName="text-[13px]"
                valueClassName="text-[21px] leading-tight"
              />

              <StatCard
                title="Out of Stock"
                value={outOfStockCount}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>}
                metricHierarchy
                titleClassName="text-[13px]"
                valueClassName="text-[21px] leading-tight"
              />

              <FinancialStatCard
                title="Inventory Value"
                value={formatCurrency(inventoryValue)}
                hiddenValue="P ••••••"
                showFinancials={showFinancials}
                onToggle={() => setShowFinancials((prev) => !prev)}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-10">
            <div className={`analytics-chart relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm ${reportType === 'sales' ? 'min-h-[320px] h-full lg:col-span-5' : reportType === 'inventory' ? 'reports-inventory-analytics-card min-h-[300px] lg:min-h-0 lg:h-full lg:col-span-10' : 'min-h-[320px] lg:col-span-7'}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 bg-gray-100 rounded-lg text-gray-900"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg></div>
                <h3 className="text-lg font-semibold text-gray-800">{reportType === 'sales' ? 'Collections Analytics' : 'Top Selling Products'}</h3>
              </div>

              {reportType === 'inventory' ? (
                topProductsPieData.length > 0 ? (
                  <div className="flex min-h-[280px] min-w-0 flex-1 items-center justify-center lg:min-h-0">
                    <div className="reports-inventory-analytics-chart h-[clamp(280px,54vh,520px)] max-h-full min-h-0 w-full">
                      <ResponsiveContainer width="100%" height="100%" debounce={300}>
                        <PieChart>
                        <ChartTooltip
                          content={(tooltipProps) => (
                            <TopSellingProductsTooltip
                              {...tooltipProps}
                              showFinancials={showFinancials}
                            />
                          )}
                        />
                        <Legend
                          iconType="circle"
                          iconSize={8}
                          layout={isCompactPieChart ? 'horizontal' : 'vertical'}
                          verticalAlign={isCompactPieChart ? 'bottom' : 'middle'}
                          align={isCompactPieChart ? 'center' : 'right'}
                          formatter={(value) => (
                            <span className="whitespace-nowrap font-medium tracking-normal" style={{ color: '#111827' }} title={String(value)}>
                              {value}
                            </span>
                          )}
                          wrapperStyle={isCompactPieChart
                            ? { fontSize: '10px', fontWeight: 400, lineHeight: '1.55', paddingTop: 6 }
                            : { fontSize: '12px', fontWeight: 400, right: 48, lineHeight: '1.65' }}
                        />
                        <Pie
                          data={topProductsPieData}
                          dataKey="value"
                          nameKey="name"
                          isAnimationActive={false}
                          cx={isCompactPieChart ? '50%' : '38%'}
                          cy={isCompactPieChart ? '42%' : '50%'}
                          outerRadius={isCompactPieChart ? '58%' : '82%'}
                          label={(props) => <ColoredPiePercentageLabel {...props} compact={isCompactPieChart} />}
                          labelLine={false}
                        >
                          {topProductsPieData.map((entry, index) => (
                            <Cell key={`reports-cell-${entry.name}`} fill={ANALYTICS_PIE_COLORS[index % ANALYTICS_PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1">
                    <EmptyAnalyticsState
                      title="No top-selling products yet"
                      subtitle="No item sales were recorded in the selected date range."
                      icon={(
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 1.343-3 3v4h6v-4c0-1.657-1.343-3-3-3zm0 0V6m-7 13h14" />
                        </svg>
                      )}
                    />
                  </div>
                )
              ) : reportType === 'sales' ? (
                trendData.length > 0 ? (
                  <div className="h-[320px] min-w-0 w-full lg:min-h-0 lg:flex-1 lg:h-auto">
                    <ResponsiveContainer width="100%" height="100%" debounce={300}>
                      <LineChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis dataKey="name" axisLine={{ stroke: '#9CA3AF', strokeWidth: 1.5 }} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11, fontWeight: 600 }} dy={8} />
                        <YAxis axisLine={false} tickLine={false} domain={[0, 'dataMax']} tick={{ fill: '#6B7280', fontSize: 10, fontWeight: 500 }} tickFormatter={formatCurrency} />
                        <ChartTooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            const { sales = 0, orders = 0 } = payload[0].payload || {};
                            return (
                              <div className="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-sm">
                                <p className="text-xs font-semibold text-gray-900">{label}</p>
                                <p className="text-xs text-gray-700">
                                  Collected: {formatCurrency(sales)}
                                </p>
                                <p className="text-xs text-gray-700">Orders: {formatNumber(orders)}</p>
                              </div>
                            );
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="sales"
                          stroke="#111827"
                          strokeWidth={2.5}
                          dot={{ r: 3, strokeWidth: 2, fill: '#111827' }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[320px] lg:min-h-0 lg:flex-1 lg:h-auto">
                    <EmptyAnalyticsState
                      title="No collection data yet"
                      subtitle="No payments were received in the selected date range."
                      icon={(
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                      )}
                    />
                  </div>
                )
              ) : (
                <div className="flex-1">
                  {topProducts.length > 0 ? (
                    <div className="space-y-2">
                      {topProducts.slice(0, 5).map((product, index) => (
                        <div key={product.code} className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white font-semibold text-xs ${index === 0 ? 'bg-gray-900' : index === 1 ? 'bg-gray-700' : index === 2 ? 'bg-gray-500' : 'bg-gray-400'}`}>{index + 1}</div>
                          <div className="flex-1">
                            <p className="font-semibold text-sm text-gray-800">{product.name}</p>
                            <p className="text-xs text-gray-500">{product.qty} units sold</p>
                          </div>
                          <p className="font-semibold text-sm text-gray-900">{formatCurrency(product.revenue)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyAnalyticsState
                      title="No top-selling products yet"
                      subtitle="No item sales were recorded in the selected date range."
                      icon={(
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 1.343-3 3v4h6v-4c0-1.657-1.343-3-3-3zm0 0V6m-7 13h14" />
                        </svg>
                      )}
                    />
                  )}

                </div>
              )}
            </div>


          {reportType === 'sales' && (
            <div className="analytics-chart relative flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm lg:col-span-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="rounded-lg bg-gray-100 p-1.5 text-gray-900">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-800">Sales by Category</h3>
              </div>

              {salesByCategory.length > 0 ? (
                <div className="h-[320px] min-w-0 w-full lg:min-h-0 lg:flex-1 lg:h-auto">
                  <ResponsiveContainer width="100%" height="100%" debounce={300}>
                    <PieChart margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                      <ChartTooltip
                        content={(tooltipProps) => (
                          <SalesByCategoryTooltip
                            {...tooltipProps}
                            showFinancials={showFinancials}
                          />
                        )}
                      />
                      <Pie
                        data={salesByCategory}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="36%"
                        outerRadius="60%"
                        cx={isCompactPieChart ? '50%' : '38%'}
                        cy="50%"
                        paddingAngle={2}
                        isAnimationActive={false}
                        label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {salesByCategory.map((entry, index) => (
                          <Cell key={`reports-category-${entry.name}`} fill={ANALYTICS_PIE_COLORS[index % ANALYTICS_PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend
                        layout={isCompactPieChart ? 'horizontal' : 'vertical'}
                        align={isCompactPieChart ? 'center' : 'right'}
                        verticalAlign={isCompactPieChart ? 'bottom' : 'middle'}
                        iconType="circle"
                        iconSize={6}
                        wrapperStyle={isCompactPieChart
                          ? { paddingTop: 4, fontSize: 10, lineHeight: '1.4' }
                          : { paddingLeft: 0, fontSize: 10, lineHeight: '1.4' }}
                        formatter={(value) => {
                          const category = salesByCategory.find((entry) => entry.name === value);
                          return <span style={{ color: '#111827' }}>{`${value} — ${Number(category?.percentage || 0).toFixed(0)}%`}</span>;
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[320px] lg:min-h-0 lg:flex-1 lg:h-auto">
                  <EmptyAnalyticsState
                    title="No category sales yet"
                    subtitle="No category sales were recorded in the selected date range."
                    icon={(
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                      </svg>
                    )}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    {showExportMenu && (
      <div
        className="pdf-exclude fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
        role="presentation"
        onMouseDown={(event) => { if (event.target === event.currentTarget) closeExportModal(); }}
      >
        <div role="dialog" aria-modal="true" aria-labelledby="export-report-title" className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200/80 bg-slate-50 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] dark:border-slate-700/80 dark:bg-[#24262a] dark:shadow-[0_20px_50px_-24px_rgba(0,0,0,0.6)]">
          <div className="border-b border-slate-200/70 px-5 py-4 dark:border-slate-700/70">
            <h2 id="export-report-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">Export Report</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose a date range for this file without changing the report view.</p>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {!isAdminInventoryOnly && (
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Report
                  <select value={exportType} disabled={isExporting} onChange={(event) => setExportType(event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-300/40 disabled:opacity-60 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-500/25">
                    <option value="sales">Sales</option>
                    <option value="inventory">Inventory</option>
                    <option value="combined">Combined</option>
                  </select>
                </label>
              )}
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Format
                <select value={exportFormat} disabled={isExporting} onChange={(event) => setExportFormat(event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-300/40 disabled:opacity-60 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-500/25">
                  <option value="pdf">PDF</option>
                  <option value="excel">Excel</option>
                </select>
              </label>
            </div>

            <ReportDateRangeSelector
              from={exportStartDate}
              to={exportEndDate}
              onChange={updateExportRange}
              disabled={isExporting}
              error={exportRangeError}
            />
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-slate-200/70 px-5 py-3 sm:flex-row sm:justify-end dark:border-slate-700/70">
            <button type="button" onClick={closeExportModal} disabled={isExporting} className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 disabled:opacity-50 dark:border-slate-600 dark:bg-[#2d3035] dark:text-slate-200 dark:hover:bg-[#373a40]">Cancel</button>
            <button type="button" onClick={() => runExport()} disabled={isExporting} className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white">
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
};

export default Reports;
