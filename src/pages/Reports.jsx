import React, { useState, useMemo, useEffect } from 'react';
import toast from 'react-hot-toast';
import { showToast } from '../utils/toastHelper';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/StatCard';

const TOP_SELLING_CHART_COLORS = ['#0EA5E9', '#F97316', '#10B981', '#A855F7', '#F43F5E', '#EAB308', '#14B8A6', '#6366F1'];

const EmptyAnalyticsState = ({ title, subtitle, icon }) => (
  <div className="h-full w-full flex items-center justify-center p-4">
    <div className="w-full max-w-md px-4 py-6 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full text-gray-500">
        {icon}
      </div>
      <p className="text-sm font-bold text-gray-700">{title}</p>
      <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
    </div>
  </div>
);

const FinancialStatCard = ({ title, value, hiddenValue, showFinancials, onToggle, icon }) => (
  <div className="relative overflow-hidden bg-white rounded-xl p-4 shadow-sm border-x border-b border-gray-100 hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1 group">
    <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black" />
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-gray-500 text-sm font-bold uppercase tracking-wider mb-1 group-hover:text-gray-900 transition-colors">{title}</h3>
        <div className="text-lg font-black text-gray-900 tracking-tight">{showFinancials ? value : hiddenValue}</div>
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
  const [showFinancials, setShowFinancials] = useState(false);
  const [hiddenBars, setHiddenBars] = useState({ sales: false, orders: false });
  const isAdminInventoryOnly = userRole === ROLES.ADMIN;
  const showInventoryOnlyLayout = isAdminInventoryOnly || reportType === 'inventory';

  const formatMoney = (amount) => {
    if (!showFinancials) return 'P ••••••';
    return `P${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

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
  const totalItemsSold = filteredTransactions.reduce(
    (sum, transaction) => sum + (transaction.items?.reduce((itemSum, item) => itemSum + (item.qty || 0), 0) || 0),
    0
  );

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
        <div className="h-auto md:h-[calc(100vh-80px)] flex flex-col gap-2 md:overflow-visible p-2">
    <div id="report-container" className="relative h-auto md:h-full flex flex-col bg-slate-200/50 rounded-2xl shadow-sm border border-gray-100 md:overflow-visible border-t-8 border-t-[#111827] p-4">
      <div className="h-auto md:h-full flex flex-col gap-3 md:overflow-visible">
        <div className="flex flex-col gap-4 shrink-0 border-b border-gray-200 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            
            <div className="flex items-center gap-2">
              <svg className="w-7 h-7 text-gray-900 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <div className="shrink-0">
                <h1 className="text-[8px] font-black text-gray-900 leading-tight">Reports</h1>
                <p className="text-gray-500 text-xs font-medium mt-1">
                  {isAdminInventoryOnly ? 'View inventory status' : 'View sales and Inventory performance'}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start sm:items-end gap-2 w-full sm:w-auto">
              {!isAdminInventoryOnly ? (
                <div className="inline-flex rounded-lg bg-gray-100 p-1 self-start sm:self-end shrink-0">
                  <button type="button" onClick={() => setReportType('sales')} className={`px-3 py-1 rounded-md text-xs font-semibold ${reportType === 'sales' ? 'bg-gray-900 text-white' : 'text-gray-700'}`}>Sales</button>
                  <button type="button" onClick={() => setReportType('inventory')} className={`px-3 py-1 rounded-md text-xs font-semibold ${reportType === 'inventory' ? 'bg-gray-900 text-white' : 'text-gray-700'}`}>Inventory</button>
                </div>
              ) : (
                <div className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 self-start sm:self-end shrink-0">
                  Inventory Only
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
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

                <div className="pdf-exclude relative group shrink-0">
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
                  {!showExportMenu && (
                    <div className="pointer-events-none absolute right-0 top-full mt-2 z-20 rounded-md bg-gray-900/95 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-lg opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 whitespace-nowrap">
                      Export
                    </div>
                  )}
    
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
          </div>
        </div>
        <div className={`grid gap-3 ${reportType === 'inventory' ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
          {reportType === 'sales' ? (
            <>
              <FinancialStatCard
                title="Total Sales"
                value={`P${Number(totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                hiddenValue="P ••••••"
                showFinancials={showFinancials}
                onToggle={() => setShowFinancials((prev) => !prev)}
                icon={(
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              />

              <StatCard
                title="Total Orders"
                value={totalOrders}
                icon={(
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z" />
                  </svg>
                )}
                titleClassName="text-sm"
                valueClassName="text-lg"
              />

              <StatCard
                title="Items Sold"
                value={totalItemsSold}
                icon={(
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M6 7l1 12h10l1-12M9 7V5a3 3 0 016 0v2" />
                  </svg>
                )}
                titleClassName="text-sm"
                valueClassName="text-lg"
              />
            </>
          ) : (
            <>
              <StatCard
                title="Total Products"
                value={inventory.length}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
                titleClassName="text-sm"
                valueClassName="text-lg"
              />

              <StatCard
                title="Low Stock Items"
                value={lowStockCount}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
                titleClassName="text-sm"
                valueClassName="text-lg"
              />

              <StatCard
                title="Out of Stock"
                value={outOfStockCount}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>}
                titleClassName="text-sm"
                valueClassName="text-lg"
              />

              <FinancialStatCard
                title="Inventory Value"
                value={`P${Number(inventoryValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                hiddenValue="P ••••••"
                showFinancials={showFinancials}
                onToggle={() => setShowFinancials((prev) => !prev)}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
            <div className={`relative overflow-hidden bg-white rounded-xl shadow-sm p-4 border border-gray-100 ${reportType === 'sales' || reportType === 'inventory' ? 'lg:col-span-10' : 'lg:col-span-7'}`}>
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black" />
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 bg-gray-100 rounded-lg text-gray-900"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg></div>
                <h3 className="text-lg font-bold text-gray-800">{reportType === 'sales' ? 'Sales Analytics' : 'Top Selling Products'}</h3>
              </div>

              {reportType === 'inventory' ? (
                topProductsPieData.length > 0 ? (
                  <div className="h-64 md:h-68 w-full pb-1">
                    <ResponsiveContainer width="100%" height="100%" debounce={300}>
                      <PieChart>
                        <ChartTooltip
                          formatter={(value, _name, item) => {
                            const revenue = item?.payload?.revenue || 0;
                            const revenueLabel = showFinancials
                              ? `P${Number(revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                              : 'P••••••';
                            return [`${value} units • ${revenueLabel}`, 'Top Selling'];
                          }}
                        />
                        <Legend
                          iconType="circle"
                          iconSize={8}
                          layout="vertical"
                          verticalAlign="middle"
                          align="right"
                          formatter={(value) => <span style={{ color: '#111827' }}>{value}</span>}
                          wrapperStyle={{ fontSize: '11px', fontWeight: 400, letterSpacing: '0.03em', right: 110, lineHeight: '1.35' }}
                        />
                        <Pie
                          data={topProductsPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="36%"
                          cy="50%"
                          outerRadius="68%"
                          label={({ percent, x, y, textAnchor, dominantBaseline }) => (
                            <text
                              x={x}
                              y={y}
                              fill="#111827"
                              textAnchor={textAnchor}
                              dominantBaseline={dominantBaseline}
                              fontSize={11}
                              fontWeight={700}
                            >
                              {(percent * 100).toFixed(0)}%
                            </text>
                          )}
                          labelLine={false}
                        >
                          {topProductsPieData.map((entry, index) => (
                            <Cell key={`reports-cell-${entry.name}`} fill={TOP_SELLING_CHART_COLORS[index % TOP_SELLING_CHART_COLORS.length]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
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
                )
              ) : reportType === 'sales' ? (
                trendData.length > 0 ? (
                  <div className="h-64 md:h-68 w-full">
                    <ResponsiveContainer width="100%" height="100%" debounce={300}>
                      <BarChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis dataKey="name" axisLine={{ stroke: '#9CA3AF', strokeWidth: 1.5 }} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11, fontWeight: 600 }} dy={8} />
                        <YAxis yAxisId="sales" axisLine={false} tickLine={false} domain={[0, 'dataMax']} tick={{ fill: '#6B7280', fontSize: 10, fontWeight: 500 }} tickFormatter={(value) => {
                          if (!showFinancials) return 'P***';
                          return value >= 1000 ? `P${(value / 1000).toFixed(0)}k` : `P${value}`;
                        }} />
                        <YAxis yAxisId="orders" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 10 }} allowDecimals={false} />
                        <ChartTooltip formatter={(value, name) => {
                          if (name === 'sales') {
                            return [showFinancials ? `P${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'P••••••', 'Sales'];
                          }
                          return [value, 'Orders'];
                        }} />
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
                  <EmptyAnalyticsState
                    title="No sales data yet"
                    subtitle="No transaction sales were recorded in the selected date range."
                    icon={(
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    )}
                  />
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


          </div>
      </div>
    </div>
    </div>
  );
};

export default Reports;
