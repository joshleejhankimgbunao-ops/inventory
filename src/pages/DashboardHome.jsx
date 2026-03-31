import React, { useState, useMemo } from 'react';
import StatCard from '../components/StatCard';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';

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
                const yearAgo = new Date(today);
                yearAgo.setFullYear(yearAgo.getFullYear() - 1);
                return tDate >= yearAgo;
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
            const key = new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (!byDate[key]) byDate[key] = { name: key, sales: 0, orders: 0 };
            byDate[key].sales += t.total || 0;
            byDate[key].orders += 1;
        });
        return Object.values(byDate).sort((a, b) => new Date(a.name) - new Date(b.name));
    }, [selectedDateTransactions]);

    const topProducts = useMemo(() => {
        const productStats = {};
        selectedDateTransactions.forEach(t => {
            t.items.forEach(item => {
                if (!productStats[item.code]) {
                    productStats[item.code] = { code: item.code, name: `${item.brand ? item.brand + ' ' : ''}${item.name}${item.color ? ' — ' + item.color : ''}`, sales: 0, revenue: 0 };
                }
                productStats[item.code].sales += item.qty || 0;
                productStats[item.code].revenue += (item.price || 0) * (item.qty || 0);
            });
        });

        return Object.values(productStats)
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 10)
            .map((p, idx) => ({ id: idx + 1, name: p.name, sales: p.sales, revenue: `₱ ${p.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, percent: Math.min(100, Math.round((p.sales / 50) * 100)) }));
    }, [selectedDateTransactions]);

    const topSellingPieData = useMemo(() => {
        return topProducts.map(product => ({
            name: product.name,
            value: product.sales,
        }));
    }, [topProducts]);

    const isAdminUser = userRole === ROLES.ADMIN;
    const isSuperAdminUser = isSuperAdmin();
    const showPieAnalytics = isAdminUser || (isSuperAdminUser && superAdminAnalyticsView === 'pie');

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
        return processedInventory.filter(i => i.status === 'Critical' || i.status === 'Out of Stock');
    }, [processedInventory]);

    const lowStockCount = lowStockItems.length;

    const totalInventoryValue = useMemo(() => {
        return processedInventory.reduce((sum, it) => sum + ((it.price || 0) * (it.stock || 0)), 0);
    }, [processedInventory]);
    // non-sales metrics
    const totalProducts = processedInventory.length;
    const totalUsers = useMemo(() => {
        const stored = localStorage.getItem('users');
        return stored ? JSON.parse(stored).length : 0;
    }, []);

    return (
        <div className="flex flex-col p-4 gap-2 h-auto md:h-full md:overflow-hidden mb-1 bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 shrink-0 gap-4 md:gap-0">
                <div className="flex items-center gap-2">
                    <div className="shrink-0 hidden sm:block">
                        <svg className="w-10 h-10 md:w-7 md:h-7 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
                    </div>
                    <div>
                        <h1 className="text-xl md:text-[8px] font-black text-gray-900 dark:text-white leading-tight">Dashboard Overview</h1>
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
                        className="p-2 rounded-lg bg-white border-2 border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all shadow-sm"
                        title={showFinancials ? "Hide Financial Values" : "Show Financial Values"}
                    >
                        {showFinancials ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                        )}
                    </button>)}
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                                title="Low Stock Items"
                                value={lowStockCount.toString()}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>}
                                color="yellow"
                                onClick={() => onNavigate && onNavigate('Product List')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />
                            <StatCard
                                title="Out of Stocks"
                                value={processedInventory.filter(i=>i.status==='Out of Stock').length.toString()}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728"/></svg>}
                                color="red"
                                onClick={() => onNavigate && onNavigate('Product List')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />
                            <StatCard
                                title="My Transactions (Today)"
                                value={transactions.filter(t=>{const d=new Date(t.date);const n=new Date();return t.cashier===currentUserName&&d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth()&&d.getDate()===n.getDate();}).length.toString()}
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
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-4.418 0-8 1.79-8 4v4h16v-4c0-2.21-3.582-4-8-4z"/></svg>}
                                color="indigo"
                                onClick={() => onNavigate && onNavigate('Reports')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />

                            <StatCard title="Low Stock Items" value={lowStockCount.toString()} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>} color="yellow" onClick={() => onNavigate && onNavigate('Inventory')} titleClassName="text-sm" valueClassName="text-lg" />
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
                                title="Low Stock Items"
                                value={lowStockCount.toString()}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>}
                                color="yellow"
                                onClick={() => onNavigate && onNavigate('Inventory')}
                                titleClassName="text-sm"
                                valueClassName="text-lg"
                            />
                            <StatCard
                                title="Inventory Value"
                                value={formatMoney(totalInventoryValue)}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-4.418 0-8 1.79-8 4v4h16v-4c0-2.21-3.582-4-8-4z"/></svg>}
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
                                    {topProducts.length === 0 && <div className="p-4 text-center text-gray-400 text-xs">No data.</div>}
                                </div>
                                <div className="p-2 text-center border-t border-gray-100 bg-gray-50 shrink-0">
                                    <button onClick={onViewAllProducts} className="w-full px-3 py-1.5 rounded-lg text-white font-bold text-xs shadow-md transition-all hover:opacity-90 transform hover:-translate-y-0.5" style={{ backgroundColor: '#111827', border: '2px solid #111827' }}>VIEW ALL</button>
                                </div>
                            </div>
                            <div className="bg-white p-0 rounded-xl shadow-sm border border-gray-100 flex flex-col relative overflow-hidden w-1/2 h-full min-h-0">
                                <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-yellow-500 to-yellow-600"></div>
                                <div className="px-4 py-2 border-b border-gray-100 flex justify-between items-center shrink-0">
                                    <h3 className="text-base font-black text-gray-900 uppercase tracking-wide flex items-center gap-2"><svg className="w-3.5 h-3.5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>Low Stock</h3>
                                    <span className="bg-yellow-100 text-yellow-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{lowStockCount} Items</span>
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
                                <h3 className="text-base font-black text-gray-900 uppercase tracking-wide">{showPieAnalytics ? 'Top-Selling Products' : 'Sales Analytics'}</h3>
                            </div>
                            {isSuperAdminUser && (
                                <div className="flex p-0.5 bg-gray-100/80 rounded-lg border border-gray-200/60 shadow-inner">
                                    <button
                                        onClick={() => setSuperAdminAnalyticsView('sales')}
                                        className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all duration-300 ease-out ${
                                            superAdminAnalyticsView === 'sales' 
                                                ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' 
                                                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                                        }`}
                                    >
                                        <svg className={`w-3.5 h-3.5 transition-transform duration-300 ${superAdminAnalyticsView === 'sales' ? 'scale-110' : 'scale-100'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                                        </svg>
                                        Trends
                                    </button>
                                    <button
                                        onClick={() => setSuperAdminAnalyticsView('pie')}
                                        className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all duration-300 ease-out ${
                                            superAdminAnalyticsView === 'pie' 
                                                ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' 
                                                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                                        }`}
                                    >
                                        <svg className={`w-3.5 h-3.5 transition-transform duration-300 ${superAdminAnalyticsView === 'pie' ? 'scale-110' : 'scale-100'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                                        </svg>
                                        Mix
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
                                                        wrapperStyle={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em', right: 4, lineHeight: '1.2' }}
                                                    />
                                                    <Pie
                                                        data={topSellingPieData}
                                                        dataKey="value"
                                                        nameKey="name"
                                                        cx="36%"
                                                        cy="50%"
                                                        outerRadius="68%"
                                                        label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                                                        labelLine={false}
                                                    >
                                                        {topSellingPieData.map((entry, index) => (
                                                            <Cell key={`cell-${entry.name}`} fill={['#111827', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB'][index % 5]} />
                                                        ))}
                                                    </Pie>
                                                </PieChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <div className="h-full w-full flex items-center justify-center text-xs text-gray-400 font-medium">No top-selling data in selected range.</div>
                                        )}
                                    </>
                                ) : (
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
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-3 flex flex-col gap-2 h-full min-h-0 overflow-hidden">
                        <div className="bg-white p-0 rounded-xl shadow-sm border border-gray-100 flex flex-col relative overflow-hidden flex-1 min-h-0">
                            <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-yellow-500 to-yellow-600"></div>
                            <div className="px-3 py-1.5 border-b border-gray-100 flex justify-between items-center shrink-0">
                                <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide flex items-center gap-2"><svg className="w-3.5 h-3.5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>Low Stock</h3>
                                <span className="bg-yellow-100 text-yellow-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{lowStockCount} Items</span>
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