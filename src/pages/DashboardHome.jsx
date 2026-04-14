import React, { useState, useMemo } from 'react';
import StatCard from '../components/StatCard';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';

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

const DashboardHome = ({ onViewAllProducts, onNavigate }) => {
    const { userRole, currentUserName, isAdminOrAbove, isSuperAdmin, ROLES } = useAuth();
    const { transactions = [], processedInventory = [] } = useInventory();

    const [showFinancials, setShowFinancials] = useState(false);
    const [superAdminAnalyticsView, setSuperAdminAnalyticsView] = useState('sales');

    // helper for currency display (show or mask based on toggle)
    const formatMoney = (amount) => {
        if (!showFinancials) return '₱ ••••••';
        return `₱ ${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    };

    // state to track which bars are hidden via legend clicks
    const [hiddenBars, setHiddenBars] = useState({ sales: false, orders: false });

    const handleLegendClick = (e) => {
        // recharts passes an object containing dataKey/value when legend item is clicked
        if (!e || !e.dataKey) return;
        setHiddenBars(prev => ({ ...prev, [e.dataKey]: !prev[e.dataKey] }));
    };

    // Date range state (quick buttons)
    const [dateRange, setDateRange] = useState('today'); // 'today','week','month','year','specific_date','custom'
    const [specificDate, setSpecificDate] = useState(new Date().toISOString().split('T')[0]);
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    const selectedDateTransactions = useMemo(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return transactions.filter(t => {
            const tDate = new Date(t.date);

            if (dateRange === 'today') {
                return tDate >= today;
            } else if (dateRange === 'week') {
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                return tDate >= weekAgo;
            } else if (dateRange === 'month') {
                const monthAgo = new Date(today);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                return tDate >= monthAgo;
            } else if (dateRange === 'year') {
                return tDate.getFullYear() === today.getFullYear();
            } else if (dateRange === 'custom' && customStartDate && customEndDate) {
                const start = new Date(customStartDate);
                const end = new Date(customEndDate);
                end.setHours(23, 59, 59, 999);
                return tDate >= start && tDate <= end;
            } else if (dateRange === 'specific_date' && specificDate) {
                const target = new Date(specificDate);
                const endTarget = new Date(specificDate);
                endTarget.setHours(23, 59, 59, 999);
                return tDate >= target && tDate <= endTarget;
            }

            return true; // 'all' or undefined
        });
    }, [transactions, dateRange, customStartDate, customEndDate, specificDate]);

    // Derived data for charts and top products
    const trendData = useMemo(() => {
        const byDate = {};
        selectedDateTransactions.forEach(t => {
            const txDate = new Date(t.date);

            if (dateRange === 'year') {
                const monthIndex = txDate.getMonth();
                const monthLabel = txDate.toLocaleDateString('en-US', { month: 'short' });
                if (!byDate[monthIndex]) {
                    byDate[monthIndex] = { name: monthLabel, sales: 0, orders: 0, _sort: monthIndex };
                }
                byDate[monthIndex].sales += t.total || 0;
                byDate[monthIndex].orders += 1;
                return;
            }

            const key = txDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (!byDate[key]) byDate[key] = { name: key, sales: 0, orders: 0, _sort: txDate.getTime() };
            byDate[key].sales += t.total || 0;
            byDate[key].orders += 1;
        });
        return Object.values(byDate)
            .sort((a, b) => a._sort - b._sort)
            .map(({ _sort, ...rest }) => rest);
    }, [selectedDateTransactions, dateRange]);

    const topProducts = useMemo(() => {
        const inventoryNameByCode = new Map(
            processedInventory
                .filter((item) => item?.code)
                .map((item) => [item.code, item.name])
        );

        const productStats = {};
        selectedDateTransactions.forEach(t => {
            t.items.forEach(item => {
                if (!productStats[item.code]) {
                    const canonicalName = inventoryNameByCode.get(item.code) || item.name;
                    productStats[item.code] = { code: item.code, name: canonicalName, sales: 0, revenue: 0 };
                }
                productStats[item.code].sales += item.qty || 0;
                productStats[item.code].revenue += (item.price || 0) * (item.qty || 0);
            });
        });

        return Object.values(productStats)
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 10)
            .map((p, idx) => ({ id: idx + 1, name: p.name, sales: p.sales, revenue: `₱ ${p.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, percent: Math.min(100, Math.round((p.sales / 50) * 100)) }));
    }, [selectedDateTransactions, processedInventory]);

    const topSellingPieData = useMemo(() => {
        return topProducts.map(product => ({
            name: product.name,
            value: product.sales,
        }));
    }, [topProducts]);

    const isAdminUser = userRole === ROLES.ADMIN;
    const isSuperAdminUser = isSuperAdmin();
    const showPieAnalytics = isAdminUser || (isSuperAdminUser && superAdminAnalyticsView === 'pie');
    const analyticsTitle = showPieAnalytics ? 'Top-Selling Products' : 'Sales Analytics';

    // total revenue within selected date range
    const selectedDateSales = useMemo(() => selectedDateTransactions.reduce((s, t) => s + (t.total || 0), 0), [selectedDateTransactions]);
    // number of orders/transactions
    const selectedDateOrders = selectedDateTransactions.length;
    // total number of individual items sold in that range (used for "Sales" card)
    const selectedDateItems = useMemo(() => {
        return selectedDateTransactions.reduce((count, t) => {
            return count + (t.items ? t.items.reduce((a,i) => a + (i.qty || 0), 0) : 0);
        }, 0);
    }, [selectedDateTransactions]);

    // Low stock items from processedInventory
    const lowStockItems = useMemo(() => {
        return processedInventory
            .filter(i => i.status === 'Low Stock' || i.status === 'Out of Stock')
            .sort((a, b) => {
                const aStock = Number(a?.stock ?? 0);
                const bStock = Number(b?.stock ?? 0);
                if (aStock !== bStock) return aStock - bStock;
                return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
            });
    }, [processedInventory]);

    const lowStockCount = lowStockItems.length;

    const totalInventoryValue = useMemo(() => {
        return processedInventory.reduce((sum, it) => sum + ((it.price || 0) * (it.stock || 0)), 0);
    }, [processedInventory]);
    // non-sales metrics
    const totalProducts = processedInventory.length;
    const totalCategories = useMemo(() => {
        return new Set(
            processedInventory
                .map((item) => String(item?.category || '').trim())
                .filter(Boolean)
        ).size;
    }, [processedInventory]);
    const cashierTransactionCount = useMemo(() => {
        return selectedDateTransactions.filter((t) => t.cashier === currentUserName).length;
    }, [selectedDateTransactions, currentUserName]);
    return (
        <div className="flex flex-col p-4 gap-2 h-auto md:h-full md:overflow-hidden mb-1 bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 shrink-0 gap-4 md:gap-0">
                <div className="flex items-center gap-2">
                    <div className="shrink-0 hidden sm:block">
                        <svg className="w-10 h-10 md:w-7 md:h-7 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
                    </div>
                    <div>
                        <h1 className="text-4xl md:text-5xl font-black text-gray-900 leading-tight">Dashboard Overview</h1>
                        <p className="text-gray-500 font-medium text-xs mt-1">Welcome Back, {currentUserName}!</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative z-20">
                        <select
                            value={dateRange}
                            onChange={(e) => setDateRange(e.target.value)}
                            className="appearance-none px-4 py-2 rounded-lg text-xs font-bold transition-all hover:opacity-90 cursor-pointer pr-10 border border-gray-700 shadow-md"
                            style={{
                                backgroundColor: '#111827',
                                color: '#ffffff'
                            }}
                        >
                            <option value="today">Today</option>
                            <option value="week">This Week</option>
                            <option value="month">This Month</option>
                            <option value="year">This Year</option>
                            <option value="specific_date">Select Date</option>
                            <option value="custom">Custom Range</option>
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>

                    {dateRange === 'custom' && (
                        <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-gray-300 shadow-sm ml-0 sm:ml-2">
                            <input
                                type="date"
                                value={customStartDate}
                                max={new Date().toISOString().split('T')[0]}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                style={{ colorScheme: 'light' }}
                                className="px-2 py-1.5 rounded-md border border-gray-300 text-xs font-bold text-gray-900 bg-white focus:ring-2 focus:ring-gray-900 outline-none cursor-pointer"
                            />
                            <span className="text-gray-500 text-xs font-bold">to</span>
                            <input
                                type="date"
                                value={customEndDate}
                                max={new Date().toISOString().split('T')[0]}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                style={{ colorScheme: 'light' }}
                                className="px-2 py-1.5 rounded-md border border-gray-300 text-xs font-bold text-gray-900 bg-white focus:ring-2 focus:ring-gray-900 outline-none cursor-pointer"
                            />
                        </div>
                    )}

                    {dateRange === 'specific_date' && (
                        <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-gray-300 shadow-sm ml-0 sm:ml-2">
                            <input
                                type="date"
                                value={specificDate}
                                max={new Date().toISOString().split('T')[0]}
                                onChange={(e) => setSpecificDate(e.target.value)}
                                style={{ colorScheme: 'light' }}
                                className="px-2 py-1.5 rounded-md border border-gray-300 text-xs font-bold text-gray-900 bg-white focus:ring-2 focus:ring-gray-900 outline-none cursor-pointer"
                            />
                        </div>
                    )}

                    {isAdminOrAbove() && (
                    <button 
                        onClick={() => setShowFinancials(!showFinancials)}
                        className="group/btn relative p-2 rounded-lg border-2 border-gray-200 text-gray-600 hover:text-gray-900 transition-all"
                    >
                        {showFinancials ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                        )}
                        <span className="absolute bottom-full right-0 mb-2 hidden group-hover/btn:block z-9999 w-max pointer-events-none">
                            <span className="bg-gray-900 text-white text-[10px] rounded py-1 px-2 shadow-lg block whitespace-nowrap">
                                {showFinancials ? 'Hide Financials' : 'Show Financials'}
                            </span>
                            <span className="w-2 h-2 bg-gray-900 rotate-45 absolute -bottom-1 right-3 block"></span>
                        </span>
                    </button>)}
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {userRole === ROLES.CASHIER ? (
                        <>
                            <StatCard
                                title="Total Products"
                                value={processedInventory.length.toString()}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M3 12h18M3 17h18"/></svg>}
                                color="gray"
                                onClick={() => onNavigate && onNavigate('Product List')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />
                            <StatCard
                                title="Total Categories"
                                value={totalCategories.toString()}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7h6m-6 5h6m-6 5h6m6-10h4m-4 5h4m-4 5h4"/></svg>}
                                color="indigo"
                                onClick={() => onNavigate && onNavigate('Product List')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />
                            <StatCard
                                title="My Transactions"
                                value={cashierTransactionCount.toString()}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>}
                                color="amber"
                                onClick={() => onNavigate && onNavigate('History Logs')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />
                        </>
                    ) : userRole === ROLES.SUPER_ADMIN ? (
                        <>
                            <StatCard
                                title="Sales"
                                value={formatMoney(selectedDateSales)}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 17l6-6 4 4 7-7" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 8h6v6" /></svg>}
                                color="green"
                                onClick={() => onNavigate && onNavigate('Reports')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />

                            <StatCard title="Orders" value={selectedDateOrders.toString()} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>} color="amber" onClick={() => onNavigate && onNavigate('History Logs')} titleClassName="text-sm" valueClassName="text-lg" />

                            <StatCard
                                title="Total Inventory Value"
                                value={formatMoney(totalInventoryValue)}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7.5A2.5 2.5 0 015.5 5h11A2.5 2.5 0 0119 7.5V8h1.5A1.5 1.5 0 0122 9.5v7a1.5 1.5 0 01-1.5 1.5H5.5A2.5 2.5 0 013 15.5v-8z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 8v7"/><circle cx="16" cy="12.5" r="1" fill="currentColor" stroke="none"/></svg>}
                                color="indigo"
                                onClick={() => onNavigate && onNavigate('Reports')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />
                        </>
                    ) : userRole === ROLES.ADMIN ? (
                        <>
                            <StatCard
                                title="Total Products"
                                value={totalProducts.toString()}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M3 12h18M3 17h18"/></svg>}
                                color="gray"
                                onClick={() => onNavigate && onNavigate('Product List')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />
                            <StatCard
                                title="Orders"
                                value={selectedDateOrders.toString()}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>}
                                color="amber"
                                onClick={() => onNavigate && onNavigate('History Logs')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />
                            <StatCard
                                title="Inventory Value"
                                value={formatMoney(totalInventoryValue)}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7.5A2.5 2.5 0 015.5 5h11A2.5 2.5 0 0119 7.5V8h1.5A1.5 1.5 0 0122 9.5v7a1.5 1.5 0 01-1.5 1.5H5.5A2.5 2.5 0 013 15.5v-8z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 8v7"/><circle cx="16" cy="12.5" r="1" fill="currentColor" stroke="none"/></svg>}
                                color="indigo"
                                onClick={() => onNavigate && onNavigate('Reports')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />
                        </>
                    ) : null} 
                  </div>
                {userRole === ROLES.CASHIER && (
                    <div className="flex flex-col gap-4 w-full min-w-0">
                        <div className="flex gap-4 w-full justify-between px-2 h-[52vh] min-h-0 overflow-hidden">
                            {/* top-selling and low stock side by side */}
                            <div className="bg-white p-0 rounded-xl shadow-sm border border-gray-100 flex flex-col relative overflow-hidden w-1/2 h-full min-h-0">
                                <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black"></div>
                                <div className="px-4 py-2 flex items-center gap-2 shrink-0">
                                    <div className="p-1 bg-gray-100 rounded-lg text-gray-900">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                                    </div>
                                    <h3 className="text-base font-black text-gray-900 uppercase tracking-wide">Top-Selling Product</h3>
                                </div>
                                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2">
                                    <table className="w-full text-left border-separate border-spacing-0">
                                        <thead className="text-[10px] uppercase text-white bg-gray-900 sticky top-0 z-10 font-bold tracking-wider">
                                            <tr>
                                                <th className="px-2 py-1 font-bold tracking-wider border border-gray-700">Product</th>
                                                <th className="px-2 py-1 text-right font-bold tracking-wider border border-gray-700">Vol</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50 dark:divide-gray-700 text-xs">
                                            {topProducts.map(product => (
                                                <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                                                    <td className="px-2 py-1 border border-gray-200 dark:border-gray-700">
                                                        <div className="flex items-center gap-2">
                                                            <div className={`w-4 h-4 rounded-full flex items-center justify-center font-bold text-[9px] ${product.id === 1 ? 'bg-gray-900 text-white shadow-lg' : 'bg-gray-100 text-gray-500'}`}>
                                                                {product.id}
                                                            </div>
                                                            <span className="font-bold text-gray-900 truncate max-w-25 dark:text-white">{product.name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-2 py-1 text-right border border-gray-200 dark:border-gray-700"><span className="font-bold text-gray-900 dark:text-white">{product.sales}</span></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {topProducts.length === 0 && (
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
                                <div className="p-2 text-center border-t border-gray-100 bg-gray-50 shrink-0">
                                    <button onClick={onViewAllProducts} className="w-full px-3 py-1.5 rounded-lg text-white font-bold text-xs shadow-md transition-all hover:opacity-90 transform hover:-translate-y-0.5" style={{ backgroundColor: '#111827', border: '2px solid #111827' }}>VIEW ALL</button>
                                </div>
                            </div>
                            <div className="bg-white p-0 rounded-xl shadow-sm border border-gray-100 flex flex-col relative overflow-hidden w-1/2 h-full min-h-0">
                                <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black"></div>
                                <div className="px-4 py-2 border-b border-gray-100 flex justify-between items-center shrink-0">
                                    <h3 className="text-base font-black text-gray-900 uppercase tracking-wide flex items-center gap-2"><svg className="w-3.5 h-3.5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>Low/Out of Stock</h3>
                                    <span className="bg-gray-100 text-gray-900 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{lowStockCount} Items</span>
                                </div>
                                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2">
                                    {lowStockItems.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-gray-400"><svg className="w-8 h-8 mb-1 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><p className="text-xs font-medium">All stocked</p></div>
                                    ) : (
                                        <div className="space-y-1">
                                            {lowStockItems.map(item => (
                                                <div key={item.code} className="flex items-center justify-between p-1.5 bg-yellow-50 rounded-lg border border-yellow-100">
                                                    <div className="truncate max-w-30"><p className="text-xs font-bold text-gray-900 truncate">{item.brand ? `${item.brand} ` : ''}{item.name}</p><p className="text-[10px] text-yellow-600 font-mono truncate">{item.code}</p></div>
                                                    <div className="text-right shrink-0"><p className="text-sm font-black text-yellow-600">{item.stock}</p></div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        {isAdminOrAbove() && (
                        <div className="bg-white p-0 rounded-xl shadow-sm border border-gray-100 relative overflow-hidden group flex flex-col h-full">
                            <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black"></div>
                            <div className="flex justify-between items-center px-4 py-2 shrink-0">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-gray-100 rounded-lg text-gray-900">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                                    </div>
                                    <h3 className="text-base font-black text-gray-900 uppercase tracking-wide">Sales Analytics</h3>
                                </div>
                            </div>
                        </div>
                        )}
                    </div>
                )}
               
                {isAdminOrAbove() && (
                    <div className="grid grid-cols-1 lg:grid-cols-10 gap-4 mb-2 flex-1 min-h-0">
                    <div className="lg:col-span-7 bg-white p-0 rounded-xl shadow-sm border border-gray-100 relative overflow-hidden group flex flex-col h-full min-h-0">
                        <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black"></div>
                        <div className="flex justify-between items-center px-4 py-2 shrink-0">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-gray-100 rounded-lg text-gray-900">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                                </div>
                                <h3 className="text-base font-black text-gray-900 uppercase tracking-wide">{analyticsTitle}</h3>
                            </div>
                            {isSuperAdminUser && (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setSuperAdminAnalyticsView('sales')}
                                        className={`group/toggle relative flex items-center rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-all duration-300 ease-out ${
                                            superAdminAnalyticsView === 'sales' 
                                                ? 'border-gray-300 bg-white text-gray-900 shadow-sm' 
                                                : 'border-gray-200 bg-gray-100/80 text-gray-500 hover:text-gray-700 hover:bg-gray-200/70'
                                        }`}
                                        title="Sales Analytics"
                                    >
                                        <svg className={`w-3.5 h-3.5 transition-transform duration-300 ${superAdminAnalyticsView === 'sales' ? 'scale-110' : 'scale-100'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                                        </svg>
                                        <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover/toggle:ml-1.5 group-hover/toggle:max-w-32 group-hover/toggle:opacity-100">
                                            Sales Analytics
                                        </span>
                                    </button>
                                    <button
                                        onClick={() => setSuperAdminAnalyticsView('pie')}
                                        className={`group/toggle relative flex items-center rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-all duration-300 ease-out ${
                                            superAdminAnalyticsView === 'pie' 
                                                ? 'border-gray-300 bg-white text-gray-900 shadow-sm' 
                                                : 'border-gray-200 bg-gray-100/80 text-gray-500 hover:text-gray-700 hover:bg-gray-200/70'
                                        }`}
                                        title="Top-Selling Products"
                                    >
                                        <svg className={`w-3.5 h-3.5 transition-transform duration-300 ${superAdminAnalyticsView === 'pie' ? 'scale-110' : 'scale-100'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                                        </svg>
                                        <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover/toggle:ml-1.5 group-hover/toggle:max-w-36 group-hover/toggle:opacity-100">
                                            Top-Selling Products
                                        </span>
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-h-0 w-full pl-2 pr-0 relative overflow-hidden">
                            <div className="h-64 md:h-72 w-full pr-2">
                                {showPieAnalytics ? (
                                    <>
                                        {topSellingPieData.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%" debounce={300}>
                                                <PieChart>
                                                    <Tooltip formatter={(value) => [value, 'Qty Sold']} />
                                                    <Legend
                                                        iconType="circle"
                                                        iconSize={8}
                                                        layout="vertical"
                                                        verticalAlign="middle"
                                                        align="right"
                                                        formatter={(value) => <span style={{ color: '#111827' }}>{value}</span>}
                                                        wrapperStyle={{ fontSize: '11px', fontWeight: 400, letterSpacing: '0.03em', right: 4, lineHeight: '1.35' }}
                                                    />
                                                    <Pie
                                                        data={topSellingPieData}
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
                                                        {topSellingPieData.map((entry, index) => (
                                                            <Cell key={`cell-${entry.name}`} fill={TOP_SELLING_CHART_COLORS[index % TOP_SELLING_CHART_COLORS.length]} />
                                                        ))}
                                                    </Pie>
                                                </PieChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <EmptyAnalyticsState
                                                title="No top-selling data in selected range"
                                                subtitle="Try expanding the date filter to view product mix insights."
                                                icon={(
                                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                                                    </svg>
                                                )}
                                            />
                                        )}
                                    </>
                                ) : (
                                    trendData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%" debounce={300}>
                                            <BarChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                                <XAxis dataKey="name" axisLine={{ stroke: '#9CA3AF', strokeWidth: 1.5 }} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11, fontWeight: 600 }} dy={8} />
                                                <YAxis yAxisId="sales" axisLine={false} tickLine={false} domain={[0, 'dataMax']} tick={{ fill: '#6B7280', fontSize: 10, fontWeight: 500 }} tickFormatter={(v) => v >= 1000 ? `₱${(v/1000).toFixed(0)}k` : `₱${v}`} />
                                                <YAxis yAxisId="orders" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 10 }} allowDecimals={false} />
                                                <Tooltip formatter={(value, name) => (name === 'sales' ? [`₱${value.toLocaleString(undefined, {minimumFractionDigits: 2})}`, 'Sales'] : [value, 'Orders'])} />
                                                <Legend
                                                    iconType="square"
                                                    iconSize={10}
                                                    wrapperStyle={{ fontSize: '12px', fontWeight: 700, paddingTop: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}
                                                    formatter={(value) => value === 'sales' ? 'SALES (₱)' : 'ORDERS'}
                                                    onClick={handleLegendClick}
                                                />
                                                <Bar
                                                    yAxisId="sales"
                                                    dataKey="sales"
                                                    fill="#111827"
                                                    barSize={30}
                                                    hide={hiddenBars.sales}
                                                />
                                                <Bar
                                                    yAxisId="orders"
                                                    dataKey="orders"
                                                    fill="#9CA3AF"
                                                    barSize={26}
                                                    hide={hiddenBars.orders}
                                                />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <EmptyAnalyticsState
                                            title="No sales analytics in selected range"
                                            subtitle="Adjust your date filter to generate trend and order insights."
                                            icon={(
                                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 17l6-6 4 4 7-7" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 8h6v6" />
                                                </svg>
                                            )}
                                        />
                                    )
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-3 flex flex-col gap-2 h-full min-h-0 overflow-hidden">
                        <div className="bg-white p-0 rounded-xl shadow-sm border border-gray-100 flex flex-col relative overflow-hidden flex-1 min-h-0">
                            <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-gray-700 to-black"></div>
                            <div className="px-3 py-1.5 border-b border-gray-100 flex justify-between items-center shrink-0">
                                <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide flex items-center gap-2"><svg className="w-3.5 h-3.5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>Low/Out of Stock</h3>
                                <span className="bg-gray-100 text-gray-900 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{lowStockCount} Items</span>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5">
                                {lowStockItems.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-gray-400"><svg className="w-8 h-8 mb-1 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><p className="text-xs font-medium">All stocked</p></div>
                                ) : (
                                    <div className="space-y-1">
                                        {lowStockItems.map(item => (
                                            <div key={item.code} className="flex items-center justify-between p-1 bg-yellow-50 rounded-lg border border-yellow-100">
                                                <div className="truncate max-w-30"><p className="text-xs font-bold text-gray-900 truncate">{item.brand ? `${item.brand} ` : ''}{item.name}</p><p className="text-[10px] text-yellow-600 font-mono truncate">{item.code}</p></div>
                                                <div className="text-right shrink-0"><p className="text-xs font-black text-yellow-600">{item.stock}</p></div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
                    )}
            </div>
        </div>
    );
};

export default DashboardHome;