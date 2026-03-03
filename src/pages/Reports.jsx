import React, { useState, useMemo, useEffect } from 'react';
import toast from 'react-hot-toast';
import { showToast } from '../utils/toastHelper';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';

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
  const [hiddenBars, setHiddenBars] = useState({ sales: false, orders: false });
  const isAdminInventoryOnly = userRole === ROLES.ADMIN;
  const showInventoryOnlyLayout = isAdminInventoryOnly || reportType === 'inventory';

  const handleLegendClick = (entry) => {
    if (!entry || !entry.dataKey) return;
    setHiddenBars((prev) => ({ ...prev, [entry.dataKey]: !prev[entry.dataKey] }));
  };

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

  const filteredTransactions = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return (transactions || []).filter((t) => {
      const tDate = new Date(t.date);

      if (dateRange === 'today') return tDate >= today;
      if (dateRange === 'week') {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return tDate >= weekAgo;
      }
      if (dateRange === 'month') {
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return tDate >= monthAgo;
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

  const totalRevenue = filteredTransactions.reduce((s, t) => s + (t.total || 0), 0);
  const totalOrders = filteredTransactions.length;
  const activeSalesDays = new Set(
    filteredTransactions.map((t) => new Date(t.date).toISOString().split('T')[0]),
  ).size;
  const avgDailySales = activeSalesDays > 0 ? totalRevenue / activeSalesDays : 0;

  const previousPeriodRevenue = useMemo(() => {
    const hasTransactions = Array.isArray(transactions) && transactions.length > 0;
    if (!hasTransactions) return null;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const getWindow = () => {
      if (dateRange === 'today') {
        const start = today;
        const end = new Date(today);
        end.setDate(end.getDate() + 1);
        const prevStart = new Date(start);
        prevStart.setDate(prevStart.getDate() - 1);
        return { prevStart, prevEnd: start };
      }

      if (dateRange === 'week') {
        const start = new Date(today);
        start.setDate(start.getDate() - 7);
        const diffMs = today.getTime() - start.getTime();
        const prevStart = new Date(start.getTime() - diffMs);
        return { prevStart, prevEnd: start };
      }

      if (dateRange === 'month') {
        const start = new Date(today);
        start.setMonth(start.getMonth() - 1);
        const diffMs = today.getTime() - start.getTime();
        const prevStart = new Date(start.getTime() - diffMs);
        return { prevStart, prevEnd: start };
      }

      if (dateRange === 'specific_date' && specificDate) {
        const start = new Date(specificDate);
        const prevStart = new Date(start);
        prevStart.setDate(prevStart.getDate() - 1);
        return { prevStart, prevEnd: start };
      }

      if (dateRange === 'custom' && customStartDate && customEndDate) {
        const currentStart = new Date(customStartDate);
        const currentEnd = new Date(customEndDate);
        currentEnd.setHours(23, 59, 59, 999);
        const diffMs = currentEnd.getTime() - currentStart.getTime() + 1;
        const prevEnd = currentStart;
        const prevStart = new Date(currentStart.getTime() - diffMs);
        return { prevStart, prevEnd };
      }

      return null;
    };

    const window = getWindow();
    if (!window) return null;

    return transactions.reduce((sum, transaction) => {
      const transactionDate = new Date(transaction.date);
      if (Number.isNaN(transactionDate.getTime())) return sum;
      if (transactionDate >= window.prevStart && transactionDate < window.prevEnd) {
        return sum + (transaction.total || 0);
      }
      return sum;
    }, 0);
  }, [transactions, dateRange, customStartDate, customEndDate, specificDate]);

  const salesGrowthPercent = previousPeriodRevenue && previousPeriodRevenue > 0
    ? ((totalRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100
    : null;

  const topProducts = useMemo(() => {
    const stats = {};
    filteredTransactions.forEach((t) => {
      t.items?.forEach((it) => {
        if (!stats[it.code]) stats[it.code] = { code: it.code, name: it.name, qty: 0, revenue: 0 };
        stats[it.code].qty += it.qty || 0;
        stats[it.code].revenue += (it.price || 0) * (it.qty || 0);
      });
    });
    return Object.values(stats).sort((a, b) => b.revenue - a.revenue);
  }, [filteredTransactions]);

  const topProductsPieData = useMemo(() => {
    return topProducts.slice(0, 10).map((product) => ({
      name: product.name,
      value: product.qty,
      revenue: product.revenue,
    }));
  }, [topProducts]);

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

    filteredTransactions.forEach((transaction) => {
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

    return Object.values(buckets).sort((a, b) => a.sortValue - b.sortValue);
  }, [filteredTransactions, dateRange, customStartDate, customEndDate]);

  const inventoryValue = inventory.reduce((s, i) => s + ((i.stock || 0) * (i.price || 0)), 0);
  const lowStockCount = inventory.filter((i) => (i.stock || 0) <= 10).length;
  const outOfStockCount = inventory.filter((i) => (i.stock || 0) === 0).length;

  const handleExportCSV = (mode = exportType) => {
    if ((mode !== 'inventory' && filteredTransactions.length === 0) || (mode === 'inventory' && inventory.length === 0)) {
      return showToast('No Data', 'There is no data for the selected period.', 'warning', 'export-empty');
    }

    if (mode === 'inventory') {
      let csv = 'Code,Brand,Name,Color,Size,Category,Price,Stock,Status\n';
      inventory.forEach((item) => {
        csv += `"${item.code}","${item.brand || ''}","${item.name}","${item.color || ''}","${item.size || ''}","${item.category || ''}","${item.price}","${item.stock}","${item.status}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `inventory_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      return showToast('Inventory Exported', 'Inventory CSV saved to your downloads.', 'download', 'export-inv');
    }

    if (mode === 'combined') {
      let csv = 'Sales Transactions\n';
      csv += 'Transaction ID,Date,Items,Total,Cashier\n';
      filteredTransactions.forEach((t) => {
        const itemsStr = t.items?.map((i) => `${i.name}${i.qty ? ' x' + i.qty : ''}`).join('; ') || '';
        csv += `"${t.id}","${t.date}","${itemsStr}","${t.total || 0}","${t.cashier || ''}"\n`;
      });

      csv += '\nInventory Overview\n';
      csv += 'Code,Brand,Name,Color,Size,Category,Price,Stock,Status\n';
      inventory.forEach((item) => {
        csv += `"${item.code}","${item.brand || ''}","${item.name}","${item.color || ''}","${item.size || ''}","${item.category || ''}","${item.price}","${item.stock}","${item.status}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `combined_report_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      return showToast('Combined Exported', 'Combined CSV saved to your downloads.', 'download', 'export-combined');
    }

    let csv = 'Transaction ID,Date,Items,Total,Cashier\n';
    filteredTransactions.forEach((t) => {
      const itemsStr = t.items?.map((i) => `${i.name}${i.qty ? ' x' + i.qty : ''}`).join('; ') || '';
      csv += `"${t.id}","${t.date}","${itemsStr}","${t.total || 0}","${t.cashier || ''}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${mode || 'sales'}_transactions_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    showToast('CSV Exported', 'CSV file saved to your downloads.', 'download', 'export-csv');
  };

  const handleDownloadPDF = async (mode = exportType) => {
    const element = document.getElementById('report-container');
    if (!element) return showToast('Error', 'Report element not found', 'error', 'pdf-element-error');

    const previousReportType = reportType;
    const targetReportType = mode === 'combined' ? 'sales' : mode;
    const switchedReportType = !isAdminInventoryOnly && targetReportType !== reportType;
    if (!isAdminInventoryOnly && targetReportType !== reportType) {
      setReportType(targetReportType);
      await new Promise((r) => setTimeout(r, 120));
    }

    const toastKey = 'export-pdf';
    showToast('Generating PDF', 'Preparing PDF, this may take a moment...', 'loading', toastKey);
    try {
      await new Promise((r) => setTimeout(r, 400));
      const dataUrl = await toPng(element, { quality: 0.95, backgroundColor: '#ffffff', filter: (node) => !node.classList || !node.classList.contains('pdf-exclude') });
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const imgProps = pdf.getImageProperties(dataUrl);
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${mode || 'sales'}_report_${new Date().toISOString().split('T')[0]}.pdf`);
      showToast('PDF Downloaded', 'PDF saved to your downloads.', 'download', toastKey);
    } catch (error) {
      showToast('Error', `Error: ${error.message}`, 'error', toastKey);
    } finally {
      if (switchedReportType) {
        setReportType(previousReportType);
      }
    }
  };

  return (
    <div id="report-container" className="relative h-[calc(100%-0.25rem)] max-h-[calc(100%-0.25rem)] bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mx-1 mt-1 mb-0 border-t-8 border-t-[#111827] p-4">
      <div className="h-full flex flex-col gap-3 overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-7 h-7 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <div>
              <h1 className="text-[8px] font-black text-gray-900 leading-tight">Reports</h1>
              <p className="text-gray-500 text-xs font-medium mt-1">
                {isAdminInventoryOnly ? 'View inventory status and export data' : 'View sales performance and export data'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isAdminInventoryOnly ? (
              <>
                <div className="inline-flex rounded-lg bg-gray-100 p-1">
                  <button type="button" onClick={() => setReportType('sales')} className={`px-3 py-1 rounded-md text-xs font-semibold ${reportType === 'sales' ? 'bg-gray-900 text-white' : 'text-gray-700'}`}>Sales</button>
                  <button type="button" onClick={() => setReportType('inventory')} className={`px-3 py-1 rounded-md text-xs font-semibold ${reportType === 'inventory' ? 'bg-gray-900 text-white' : 'text-gray-700'}`}>Inventory</button>
                </div>

                <div className="relative flex items-center gap-2">
                  <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 text-white appearance-none pr-8" style={{ minWidth: 140 }}>
                    <option value="all">All Time</option>
                    <option value="today">Today</option>
                    <option value="week">This Week</option>
                    <option value="month">This Month</option>
                    <option value="year">This Year</option>
                    <option value="specific_date">Select Date</option>
                    <option value="custom">Custom Range</option>
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                  </div>

                  {dateRange === 'specific_date' && (
                    <input type="date" value={specificDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setSpecificDate(e.target.value)} className="ml-2 px-2 py-1.5 rounded-lg border border-gray-900 text-xs bg-white" style={{ minWidth: 140 }} />
                  )}

                  {dateRange === 'custom' && (
                    <div className="flex items-center gap-2 ml-2">
                      <input type="date" value={customStartDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setCustomStartDate(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-900 text-xs bg-white" style={{ minWidth: 140 }} />
                      <span className="text-gray-400 text-xs">to</span>
                      <input type="date" value={customEndDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setCustomEndDate(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-900 text-xs bg-white" style={{ minWidth: 140 }} />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700">
                  Inventory Only
                </div>

                <div className="relative flex items-center gap-2">
                  <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 text-white appearance-none pr-8" style={{ minWidth: 140 }}>
                    <option value="all">All Time</option>
                    <option value="today">Today</option>
                    <option value="week">This Week</option>
                    <option value="month">This Month</option>
                    <option value="year">This Year</option>
                    <option value="specific_date">Select Date</option>
                    <option value="custom">Custom Range</option>
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                  </div>

                  {dateRange === 'specific_date' && (
                    <input type="date" value={specificDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setSpecificDate(e.target.value)} className="ml-2 px-2 py-1.5 rounded-lg border border-gray-900 text-xs bg-white" style={{ minWidth: 140 }} />
                  )}

                  {dateRange === 'custom' && (
                    <div className="flex items-center gap-2 ml-2">
                      <input type="date" value={customStartDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setCustomStartDate(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-900 text-xs bg-white" style={{ minWidth: 140 }} />
                      <span className="text-gray-400 text-xs">to</span>
                      <input type="date" value={customEndDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setCustomEndDate(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-900 text-xs bg-white" style={{ minWidth: 140 }} />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="pdf-exclude relative group">
              <button
                type="button"
                onClick={() => setShowExportMenu((prev) => !prev)}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-gray-900 text-white hover:opacity-90 transition-opacity"
                aria-label="Export"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16" />
                </svg>
              </button>
              <div className="pointer-events-none absolute right-0 top-full mt-2 z-20 rounded-md bg-gray-900/95 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-lg opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 whitespace-nowrap">
                Export
              </div>

              {showExportMenu && (
                <div className="absolute right-0 top-full mt-2 z-30 w-44 rounded-lg border border-gray-200 bg-white shadow-xl p-2 space-y-2">
                  {!isAdminInventoryOnly && (
                    <select
                      value={exportType}
                      onChange={(e) => setExportType(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-md text-xs font-semibold border border-gray-200 bg-white text-gray-700"
                    >
                      <option value="sales">Sales</option>
                      <option value="inventory">Inventory</option>
                      <option value="combined">Combined</option>
                    </select>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { handleDownloadPDF(isAdminInventoryOnly ? 'inventory' : exportType); setShowExportMenu(false); }}
                      className="px-2 py-1.5 rounded-md text-[10px] font-bold bg-gray-900 text-white hover:opacity-90"
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => { handleExportCSV(isAdminInventoryOnly ? 'inventory' : exportType); setShowExportMenu(false); }}
                      className="px-2 py-1.5 rounded-md text-[10px] font-bold bg-gray-100 text-gray-800 hover:bg-gray-200"
                    >
                      CSV
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {!showInventoryOnlyLayout && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative overflow-hidden bg-white rounded-xl p-3 shadow-sm border-x border-b border-gray-100">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Total Sales</p>
              <p className="text-xl font-black text-gray-900">₱{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>

            <div className="relative overflow-hidden bg-white rounded-xl p-3 shadow-sm border-x border-b border-gray-100">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Total Orders</p>
              <p className="text-xl font-black text-gray-900">{totalOrders}</p>
            </div>

            <div className="relative overflow-hidden bg-white rounded-xl p-3 shadow-sm border-x border-b border-gray-100">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Items Sold</p>
              <p className="text-xl font-black text-gray-900">{filteredTransactions.reduce((s, t) => s + (t.items?.reduce((isum, i) => isum + (i.qty || 0), 0) || 0), 0)}</p>
            </div>

            <div className="relative overflow-hidden bg-white rounded-xl p-3 shadow-sm border-x border-b border-gray-100">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Sales Growth</p>
              <p className="text-xl font-black text-gray-900">
                {salesGrowthPercent === null
                  ? 'N/A'
                  : `${salesGrowthPercent >= 0 ? '+' : ''}${salesGrowthPercent.toFixed(1)}%`}
              </p>
              <p className="text-[10px] font-semibold text-gray-400 mt-1">vs previous period</p>
            </div>
          </div>
        )}

        {!showInventoryOnlyLayout && (
          <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
            <div className={`relative overflow-hidden bg-white rounded-xl shadow-sm p-4 border border-gray-100 ${reportType === 'sales' ? 'lg:col-span-10' : 'lg:col-span-7'}`}>
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black" />
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 bg-gray-100 rounded-lg text-gray-900"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg></div>
                <h3 className="text-lg font-bold text-gray-800">{reportType === 'inventory' ? 'Inventory Summary' : reportType === 'sales' ? 'Sales Analytics' : 'Top Selling Products'}</h3>
              </div>

              {reportType === 'inventory' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-500">Inventory Value</p>
                      <p className="text-lg font-bold text-gray-900">₱{inventoryValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">Low Stock</p>
                      <p className="text-lg font-bold text-gray-900">{lowStockCount}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">Out of Stock</p>
                      <p className="text-lg font-bold text-gray-900">{outOfStockCount}</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500">Current inventory overview. Use the Export panel to download inventory data.</p>
                </div>
              ) : reportType === 'sales' ? (
                trendData.length > 0 ? (
                  <div className="h-64 md:h-68 w-full">
                    <ResponsiveContainer width="100%" height="100%" debounce={300}>
                      <BarChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis dataKey="name" axisLine={{ stroke: '#9CA3AF', strokeWidth: 1.5 }} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11, fontWeight: 600 }} dy={8} />
                        <YAxis yAxisId="sales" axisLine={false} tickLine={false} domain={[0, 'dataMax']} tick={{ fill: '#6B7280', fontSize: 10, fontWeight: 500 }} tickFormatter={(value) => (value >= 1000 ? `₱${(value / 1000).toFixed(0)}k` : `₱${value}`)} />
                        <YAxis yAxisId="orders" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 10 }} allowDecimals={false} />
                        <ChartTooltip formatter={(value, name) => (name === 'sales' ? [`₱${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'Sales'] : [value, 'Orders'])} />
                        <Legend
                          iconType="square"
                          iconSize={10}
                          wrapperStyle={{ fontSize: '12px', fontWeight: 700, paddingTop: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}
                          formatter={(value) => (value === 'sales' ? 'SALES (₱)' : 'ORDERS')}
                          onClick={handleLegendClick}
                        />
                        <Bar yAxisId="sales" dataKey="sales" fill="#111827" barSize={30} hide={hiddenBars.sales} />
                        <Bar yAxisId="orders" dataKey="orders" fill="#9CA3AF" barSize={26} hide={hiddenBars.orders} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="py-8 text-center text-gray-400"><p>No sales data yet</p></div>
                )
              ) : (
                <div>
                  {topProducts.length > 0 ? (
                    <div className="space-y-2">
                      {topProducts.slice(0, 5).map((product, index) => (
                        <div key={product.code} className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs ${index === 0 ? 'bg-gray-900' : index === 1 ? 'bg-gray-700' : index === 2 ? 'bg-gray-500' : 'bg-gray-400'}`}>{index + 1}</div>
                          <div className="flex-1">
                            <p className="font-semibold text-sm text-gray-800">{product.name}</p>
                            <p className="text-xs text-gray-500">{product.qty} units sold</p>
                          </div>
                          <p className="font-bold text-sm text-gray-900">₱{product.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-gray-400"><p>No sales data yet</p></div>
                  )}

                </div>
              )}
            </div>

            {reportType !== 'sales' && (
              <div className="relative overflow-hidden bg-white rounded-xl shadow-sm p-4 border border-gray-100 print:hidden pdf-exclude lg:col-span-3">
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black" />
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-gray-100 rounded-lg text-gray-900"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg></div>
                  <h3 className="text-lg font-bold text-gray-800">Export Reports</h3>
                </div>

                <div className="space-y-2">
                  {reportType === 'inventory' && (
                    <button onClick={handleExportCSV} className="w-full flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100">Inventory CSV</button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {reportType !== 'sales' && (
          <div className="relative overflow-hidden bg-white rounded-xl shadow-sm p-3 border border-gray-100 flex-1 min-h-0">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black" />
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-gray-100 rounded-lg text-gray-900"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg></div>
              <h3 className="text-lg font-bold text-gray-800">Inventory Overview</h3>
            </div>

            <p className="text-xs text-gray-500 mb-2">Metrics sourced from current inventory data</p>

            <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
            <div className="shrink-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="p-1.5 bg-gray-50 rounded-lg flex items-center gap-2">
                <div className="p-1.5 bg-gray-900 rounded-lg shadow-sm"><svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg></div>
                <div>
                  <p className="text-xs font-medium text-gray-500">Total Products</p>
                  <p className="text-base font-bold text-gray-900">{inventory.length}</p>
                </div>
              </div>

              <div className="p-1.5 bg-gray-50 rounded-lg flex items-center gap-2">
                <div className="p-1.5 bg-gray-900 rounded-lg shadow-sm"><svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
                <div>
                  <p className="text-xs font-medium text-gray-500">Inventory Value</p>
                  <p className="text-base font-bold text-gray-900">₱{inventoryValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
              </div>

              <div className="p-1.5 bg-gray-100 rounded-lg flex items-center gap-2">
                <div className="p-1.5 bg-gray-900 rounded-lg shadow-sm"><svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg></div>
                <div>
                  <p className="text-xs font-medium text-gray-600">Low Stock Items</p>
                  <p className="text-base font-bold text-gray-800">{lowStockCount}</p>
                </div>
              </div>

              <div className="p-1.5 bg-gray-200 rounded-lg flex items-center gap-2">
                <div className="p-1.5 bg-gray-900 rounded-lg shadow-sm"><svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg></div>
                <div>
                  <p className="text-xs font-medium text-gray-700">Out of Stock</p>
                  <p className="text-base font-bold text-gray-900">{outOfStockCount}</p>
                </div>
              </div>
            </div>
            </div>

            <div className="min-h-0 border-t border-gray-100 pt-2 flex flex-col overflow-hidden">
              <h4 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
                <span className="inline-flex items-center justify-center p-1 rounded-md bg-gray-100 text-gray-900">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                </span>
                Top Selling Products
              </h4>
              {topProductsPieData.length > 0 ? (
                <div className="h-64 md:h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%" debounce={300}>
                    <PieChart>
                      <ChartTooltip
                        formatter={(value, _name, item) => {
                          const revenue = item?.payload?.revenue || 0;
                          return [`${value} units • ₱${Number(revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'Top Selling'];
                        }}
                      />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        layout="vertical"
                        verticalAlign="middle"
                        align="right"
                        wrapperStyle={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em', right: 4, lineHeight: '1.2' }}
                      />
                      <Pie
                        data={topProductsPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="36%"
                        cy="50%"
                        outerRadius="68%"
                        label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {topProductsPieData.map((entry, index) => (
                          <Cell key={`reports-cell-${entry.name}`} fill={['#111827', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB'][index % 5]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-xs text-gray-400">No sales data yet.</p>
              )}
            </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Reports;
