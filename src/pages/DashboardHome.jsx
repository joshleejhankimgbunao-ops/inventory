import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import StatCard from '../components/StatCard';
import StockMovement from '../components/StockMovement';
import { getDashboardBusinessDate, getDashboardReportingPeriod } from '../../shared/dashboardReportingPeriod.mjs';
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { formatCurrency, formatNumber } from '../utils/numberFormat';
import { DASHBOARD_BAR_ACTIVE_COLOR, DASHBOARD_BAR_COLOR, SALES_ANALYTICS_LINE_STYLE } from '../utils/analyticsChart';
import { areTopSellingProductRowsStable, buildDashboardSalesByCategory, buildDashboardTopSellingProducts, getBoundedChartTooltipPosition, wrapDashboardCategoryLabel } from '../utils/dashboardOverviewCharts.mjs';
import { getConfiguredCategoryCount } from '../utils/categorySummary';
import { getCreditTransactionsDashboardSnapshotApi } from '../services/inventoryApi';
import { getOutstandingCreditSummary } from '../utils/creditDueStatus';
import { getDashboardComparisonPeriod, getMetricTrend, getPreviousPeriodMetrics } from '../utils/dashboardTrend';
import MetricTrendLine from '../components/MetricTrendLine';
import { getValidSales, isSalePhysicallyFulfilledForItemReporting } from '../../shared/saleLifecycle.mjs';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { getCashierDashboardSales, getCashierSalesTotal } from '../utils/cashierDashboardMetrics';
import { calculateActiveInventorySellingValue } from '../utils/dashboardInventoryValuation';
import { getProductDisplayName } from '../utils/productDisplayName';

const ReceiptText = ({ className = 'h-5 w-5' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 2v20l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V2l-2 2-2-2-2 2-2-2-2 2-2-2-2 2Z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8h-6M16 12h-6M13 16h-3" />
    </svg>
);

const ANALYTICS_VIEWS = [
    ['sales', 'Sales Analytics'],
    ['products', 'Top Selling Products'],
    ['categories', 'Sales by Category'],
];
const TOP_SELLING_LABEL_WIDTH = 164;
const TOP_SELLING_TOOLTIP_HEIGHT = 82;
const CATEGORY_MIN_ITEM_WIDTH = 88;
const CATEGORY_AXIS_HEIGHT = 38;
const CATEGORY_SCROLLBAR_CLEARANCE = 16;
const TOP_SELLING_RESIZE_SETTLE_MS = 140;

const getSalesYAxisWidth = (data) => {
    const largestDataValue = Math.max(0, ...data.map((entry) => Math.abs(Number(entry?.sales) || 0)));
    const magnitude = largestDataValue > 0 ? 10 ** Math.floor(Math.log10(largestDataValue)) : 1;
    const roundedAxisMaximum = largestDataValue > 0
        ? Math.ceil(largestDataValue / magnitude) * magnitude
        : 0;
    const longestLabel = [0, largestDataValue, roundedAxisMaximum]
        .map(formatCurrency)
        .reduce((longest, label) => (label.length > longest.length ? label : longest), '');

    return Math.min(128, Math.max(64, Math.ceil(longestLabel.length * 7) + 16));
};

const TopSellingProductsTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) {
        return null;
    }

    const product = payload[0]?.payload;
    const revenue = Number(product?.revenue || 0);
    const unitsSold = formatTopProductUnits(product?.unitsSoldByUnit);

    return (
        <div className="flex h-[82px] w-56 flex-col justify-center gap-0.5 overflow-hidden rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
            <p title={product?.name || 'Unknown product'} className="truncate text-xs font-semibold leading-4 text-gray-900">{product?.name || 'Unknown product'}</p>
            {product?.code && <p title={`SKU: ${product.code}`} className="truncate text-[10px] leading-3 text-gray-500">SKU: {product.code}</p>}
            <p title={unitsSold} className="truncate text-[10px] leading-3 text-gray-600">Units Sold: {unitsSold}</p>
            <p className="truncate text-xs leading-4 text-gray-800">Sales Revenue: {formatCurrency(revenue)}</p>
        </div>
    );
};

const formatTopProductUnits = (unitsSoldByUnit = []) => {
    const entries = Array.isArray(unitsSoldByUnit) ? unitsSoldByUnit : [];
    if (entries.length === 0) return '0';
    return entries.map(({ quantity, sellingUnit }) => (
        `${formatNumber(quantity)}${sellingUnit ? ` ${sellingUnit}` : ''}`
    )).join(' + ');
};

const SalesByCategoryTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const category = payload[0]?.payload;

    return (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
            <p className="text-xs font-semibold text-gray-900">{category?.name || 'Uncategorized'}</p>
            <p className="text-xs text-gray-700">Sales: {formatCurrency(category?.value || 0)}</p>
        </div>
    );
};

const truncateAxisLabel = (value, maxCharacters = 30) => {
    const name = String(value || '').trim() || 'Unknown product';
    return name.length > maxCharacters ? `${name.slice(0, maxCharacters - 1).trimEnd()}…` : name;
};

const ProductNameAxisTick = ({ x, y, payload, products = [] }) => {
    const name = String(payload?.value || 'Unknown product');
    const displayName = truncateAxisLabel(name);
    const product = products.find((entry) => entry.displayName === payload?.value);
    const unitsSold = formatTopProductUnits(product?.unitsSoldByUnit);
    const textX = x - 4;

    return (
        <g>
            <title>{name}</title>
            <text x={textX} y={y - 2} textAnchor="end" fill="#334155" fontSize={10}>
                <tspan x={textX}>{displayName}</tspan>
                <tspan x={textX} dy={11} fill="#94A3B8" fontSize={9}>{unitsSold} sold</tspan>
            </text>
        </g>
    );
};

const CategoryAxisTick = ({ x, y, payload }) => {
    const name = String(payload?.value || 'Uncategorized');
    const lines = wrapDashboardCategoryLabel(name, 14, 2);

    return (
        <g>
            <title>{name}</title>
            <text x={x} y={y + 7} textAnchor="middle" fill="#475569" fontSize={10}>
                {lines.map((line, index) => <tspan key={`${index}-${line}`} x={x} dy={index === 0 ? 0 : 10}>{line}</tspan>)}
            </text>
        </g>
    );
};

const ProductRevenueBarLabel = ({ x, y, width, height, value }) => {
    return (
        <text x={x + width + 6} y={y + height / 2 + 4} fill="#334155" fontSize={10} textAnchor="start">
            {formatCurrency(value)}
        </text>
    );
};

const formatCompactCurrency = (value) => {
    const amount = Number(value) || 0;
    if (Math.abs(amount) >= 1000000) return `₱${(amount / 1000000).toFixed(1)}m`;
    if (Math.abs(amount) >= 10000) return `₱${(amount / 1000).toFixed(0)}k`;
    return formatCurrency(amount);
};

const getCategoryYAxisWidth = (data) => {
    const largestValue = Math.max(0, ...data.map((entry) => Math.abs(Number(entry?.value) || 0)));
    return Math.min(108, Math.max(70, Math.ceil(formatCurrency(largestValue).length * 7) + 12));
};

const SalesAnalyticsTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) {
        return null;
    }

    const { sales = 0, orders = 0 } = payload[0]?.payload || {};

    return (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-sm">
            <p className="text-xs font-semibold text-gray-900">{label}</p>
            <p className="text-xs text-gray-700">Sales: {formatCurrency(sales)}</p>
            <p className="text-xs text-gray-700">Orders: {formatNumber(orders)}</p>
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

const DashboardHome = ({ onViewAllProducts, onNavigate }) => {
    const { userRole, currentUserName, currentAuthUserId, isAdminOrAbove, ROLES } = useAuth();
    const {
        transactions = [],
        processedInventory = [],
        categories = [],
        isInventoryLoading,
        isTransactionsLoading,
        isCategoriesLoading,
        categoriesError,
    } = useInventory();

    const [showFinancials, setShowFinancials] = useState(true);
    const [analyticsView, setAnalyticsView] = useState('sales');
    const [salesTooltipPosition, setSalesTooltipPosition] = useState(null);
    const categoryChartContainerRef = React.useRef(null);
    const [categoryChartInitialDimension, setCategoryChartInitialDimension] = useState(null);
    const topSellingChartContainerRef = React.useRef(null);
    const topSellingTooltipFrameRef = React.useRef(null);
    const topSellingTooltipPositionRef = React.useRef({ x: 0, y: 0 });
    const topSellingTooltipWidthRef = React.useRef(224);
    const topSellingTooltipAnchorRef = React.useRef(null);
    const topSellingChartSizeRef = React.useRef(null);
    const topSellingResizeSettleTimerRef = React.useRef(null);
    const topSellingIsResizingRef = React.useRef(false);
    const previousTopSellingRowsRef = React.useRef(null);
    const [topSellingAnimationKey, setTopSellingAnimationKey] = useState(null);
    const [isTopSellingChartResizing, setIsTopSellingChartResizing] = useState(false);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
        typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ));
    const [creditTransactions, setCreditTransactions] = useState([]);
    const creditTransactionsRequestRef = React.useRef(0);
    const [isCreditSnapshotLoading, setIsCreditSnapshotLoading] = useState(true);
    // helper for currency display (show or mask based on toggle)
    const formatMoney = (amount) => {
        if (!showFinancials) return '₱ ••••••';
        return formatCurrency(amount);
    };

    // Date range state (quick buttons)
    const [dateRange, setDateRange] = useState('week'); // 'today','week','month','year','specific_date','custom'
    const [specificDate, setSpecificDate] = useState(getDashboardBusinessDate());
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    const isSuperAdmin = userRole === ROLES.SUPER_ADMIN;

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

        const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updateMotionPreference = (event) => setPrefersReducedMotion(event.matches);

        if (typeof motionPreference.addEventListener === 'function') {
            motionPreference.addEventListener('change', updateMotionPreference);
            return () => motionPreference.removeEventListener('change', updateMotionPreference);
        }

        motionPreference.addListener(updateMotionPreference);
        return () => motionPreference.removeListener(updateMotionPreference);
    }, []);

    useEffect(() => () => {
        if (topSellingTooltipFrameRef.current !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(topSellingTooltipFrameRef.current);
        }
        if (topSellingResizeSettleTimerRef.current !== null && typeof window !== 'undefined') {
            window.clearTimeout(topSellingResizeSettleTimerRef.current);
        }
    }, []);

    useEffect(() => {
        if (!isSuperAdmin) {
            return undefined;
        }

        let isMounted = true;
        const loadCreditTransactions = async () => {
            const requestId = ++creditTransactionsRequestRef.current;
            try {
                const rows = await getCreditTransactionsDashboardSnapshotApi();
                if (isMounted && requestId === creditTransactionsRequestRef.current) {
                    setCreditTransactions(Array.isArray(rows) ? rows : []);
                }
            } catch {
                // Keep the last successful dashboard snapshot until the next resync.
            } finally {
                if (isMounted && requestId === creditTransactionsRequestRef.current) setIsCreditSnapshotLoading(false);
            }
        };
        let refreshTimer = null;
        const scheduleRefresh = () => {
            if (refreshTimer) window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(() => {
                refreshTimer = null;
                void loadCreditTransactions();
            }, 80);
        };

        void loadCreditTransactions();
        const unsubscribeSaleCreated = subscribeRealtimeEvent('sale.created', scheduleRefresh);
        const unsubscribeSaleUpdated = subscribeRealtimeEvent('sale.updated', scheduleRefresh);
        const unsubscribeCredit = subscribeRealtimeEvent('credit-transactions.updated', scheduleRefresh);
        const unsubscribeResync = subscribeRealtimeEvent('realtime.resync', scheduleRefresh);
        return () => {
            isMounted = false;
            creditTransactionsRequestRef.current += 1;
            if (refreshTimer) window.clearTimeout(refreshTimer);
            unsubscribeSaleCreated();
            unsubscribeSaleUpdated();
            unsubscribeCredit();
            unsubscribeResync();
        };
    }, [isSuperAdmin]);
    const availableAnalyticsViews = isSuperAdmin
        ? ANALYTICS_VIEWS
        : userRole === ROLES.ADMIN
            ? ANALYTICS_VIEWS.filter(([view]) => view === 'products')
            : [];
    const activeAnalyticsView = availableAnalyticsViews.some(([view]) => view === analyticsView)
        ? analyticsView
        : availableAnalyticsViews[0]?.[0] || null;
    const analyticsTitle = availableAnalyticsViews.find(([view]) => view === activeAnalyticsView)?.[1] || 'Analytics';

    const selectedReportingPeriod = useMemo(
        () => getDashboardReportingPeriod({ dateRange, specificDate, customStartDate, customEndDate }),
        [dateRange, specificDate, customStartDate, customEndDate]
    );
    const selectedDateTransactions = useMemo(() => {
        if (!selectedReportingPeriod) return [];
        return getValidSales(transactions).filter(t => {
            const tDate = new Date(t.date);
            return tDate >= new Date(selectedReportingPeriod.start) && tDate < new Date(selectedReportingPeriod.end);
        });
    }, [transactions, selectedReportingPeriod]);

    const cashierSelectedDateTransactions = useMemo(() => getCashierDashboardSales(
        selectedDateTransactions,
        { cashierId: currentAuthUserId, cashierName: currentUserName }
    ), [selectedDateTransactions, currentAuthUserId, currentUserName]);

    const transactionsForTopProducts = userRole === ROLES.CASHIER
        ? cashierSelectedDateTransactions
        : selectedDateTransactions;

    // Derived data for charts and top products
    const trendData = useMemo(() => {
        if (!isSuperAdmin) return [];

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
            .map(({ name, sales, orders }) => ({ name, sales, orders }));
    }, [selectedDateTransactions, dateRange, isSuperAdmin]);

    const salesYAxisWidth = useMemo(() => getSalesYAxisWidth(trendData), [trendData]);

    const topProducts = useMemo(() => buildDashboardTopSellingProducts(
        transactionsForTopProducts.filter(isSalePhysicallyFulfilledForItemReporting),
        processedInventory,
        10,
        categories
    ), [categories, transactionsForTopProducts, processedInventory]);
    const topSellingBarData = useMemo(() => {
        const visibleProducts = topProducts.slice(0, 5);
        const nameCounts = new Map();
        visibleProducts.forEach(({ name }) => {
            const key = String(name || '').toLocaleLowerCase();
            nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
        });
        return visibleProducts.map((product) => ({
            ...product,
            displayName: nameCounts.get(String(product.name || '').toLocaleLowerCase()) > 1 && product.code
                ? `${product.name} (SKU ${product.code})`
                : product.name,
            value: product.revenue,
        }));
    }, [topProducts]);
    const topSellingChartKey = JSON.stringify(topSellingBarData.map(({ code, name, displayName, revenue, unitsSoldByUnit }) => [code, name, displayName, revenue, unitsSoldByUnit]));
    const handleTopSellingAnimationEnd = useCallback(() => {
        setTopSellingAnimationKey((animationKey) => (
            animationKey === topSellingChartKey ? null : animationKey
        ));
    }, [topSellingChartKey]);

    useLayoutEffect(() => {
        const previous = previousTopSellingRowsRef.current;
        const dataChanged = previous?.dataKey !== topSellingChartKey;
        if (dataChanged) {
            const canAnimateValues = previous
                && !prefersReducedMotion
                && !isTopSellingChartResizing
                && !topSellingIsResizingRef.current
                && activeAnalyticsView === 'products'
                && areTopSellingProductRowsStable(previous.rows, topSellingBarData);
            // Sync Recharts animation state before paint so values-only updates start smoothly.
            const nextAnimationKey = canAnimateValues ? topSellingChartKey : null;
            if (topSellingAnimationKey !== nextAnimationKey) {
                setTopSellingAnimationKey(nextAnimationKey);
            }
        } else if ((prefersReducedMotion || isTopSellingChartResizing) && topSellingAnimationKey !== null) {
            setTopSellingAnimationKey(null);
        }

        previousTopSellingRowsRef.current = {
            dataKey: topSellingChartKey,
            rows: topSellingBarData,
        };
    }, [topSellingChartKey, topSellingBarData, prefersReducedMotion, topSellingAnimationKey, activeAnalyticsView, isTopSellingChartResizing]);

    const applyTopSellingTooltipPosition = () => {
        const tooltipWrapper = topSellingChartContainerRef.current?.querySelector('.recharts-tooltip-wrapper');
        if (!tooltipWrapper) return;

        const { x, y } = topSellingTooltipPositionRef.current;
        tooltipWrapper.style.transform = `translate(${x}px, ${y}px)`;
        if (tooltipWrapper.firstElementChild) {
            tooltipWrapper.firstElementChild.style.width = `${topSellingTooltipWidthRef.current}px`;
        }
    };
    const scheduleTopSellingTooltipPosition = () => {
        if (typeof window === 'undefined') return;
        if (topSellingTooltipFrameRef.current !== null) {
            window.cancelAnimationFrame(topSellingTooltipFrameRef.current);
        }
        topSellingTooltipFrameRef.current = window.requestAnimationFrame(() => {
            topSellingTooltipFrameRef.current = null;
            applyTopSellingTooltipPosition();
        });
    };
    const handleTopSellingChartPointerMove = (event) => {
        const chartElement = event.currentTarget.querySelector('.recharts-wrapper');
        const chartRect = chartElement?.getBoundingClientRect?.();
        if (!chartRect || chartRect.width <= 0 || chartRect.height <= 0) {
            topSellingTooltipAnchorRef.current = null;
            return;
        }

        const tooltipWidth = Math.max(0, Math.min(224, chartRect.width - TOP_SELLING_LABEL_WIDTH - 16));
        const minX = Math.min(TOP_SELLING_LABEL_WIDTH + 8, chartRect.width - tooltipWidth - 8);
        const anchorX = event.clientX - chartRect.left;
        const anchorY = event.clientY - chartRect.top;
        topSellingTooltipAnchorRef.current = {
            xRatio: anchorX / chartRect.width,
            yRatio: anchorY / chartRect.height,
        };
        topSellingTooltipWidthRef.current = tooltipWidth;
        Object.assign(topSellingTooltipPositionRef.current, getBoundedChartTooltipPosition({
            anchorX,
            anchorY,
            containerWidth: chartRect.width,
            containerHeight: chartRect.height,
            tooltipWidth,
            tooltipHeight: TOP_SELLING_TOOLTIP_HEIGHT,
            minX,
        }));
        scheduleTopSellingTooltipPosition();
    };
    const handleTopSellingChartResize = (width, height) => {
        if (width <= 0 || height <= 0) return;

        const measuredSize = { width: Math.round(width), height: Math.round(height) };
        const previousSize = topSellingChartSizeRef.current;
        const sizeChanged = !previousSize
            || previousSize.width !== measuredSize.width
            || previousSize.height !== measuredSize.height;
        if (!sizeChanged) return;

        topSellingChartSizeRef.current = measuredSize;
        if (previousSize) {
            if (!topSellingIsResizingRef.current) {
                topSellingIsResizingRef.current = true;
                setIsTopSellingChartResizing(true);
                if (topSellingAnimationKey !== null) setTopSellingAnimationKey(null);
            }
            if (topSellingResizeSettleTimerRef.current !== null) {
                window.clearTimeout(topSellingResizeSettleTimerRef.current);
            }
            topSellingResizeSettleTimerRef.current = window.setTimeout(() => {
                topSellingResizeSettleTimerRef.current = null;
                topSellingIsResizingRef.current = false;
                setIsTopSellingChartResizing(false);
            }, TOP_SELLING_RESIZE_SETTLE_MS);
        }

        const tooltipWidth = Math.max(0, Math.min(224, measuredSize.width - TOP_SELLING_LABEL_WIDTH - 16));
        topSellingTooltipWidthRef.current = tooltipWidth;

        const anchor = topSellingTooltipAnchorRef.current;
        if (!anchor) return;

        const minX = Math.min(TOP_SELLING_LABEL_WIDTH + 8, measuredSize.width - tooltipWidth - 8);
        Object.assign(topSellingTooltipPositionRef.current, getBoundedChartTooltipPosition({
            anchorX: anchor.xRatio * measuredSize.width,
            anchorY: anchor.yRatio * measuredSize.height,
            containerWidth: measuredSize.width,
            containerHeight: measuredSize.height,
            tooltipWidth,
            tooltipHeight: TOP_SELLING_TOOLTIP_HEIGHT,
            minX,
        }));
        scheduleTopSellingTooltipPosition();
    };
    const clearTopSellingTooltipPosition = () => {
        topSellingTooltipAnchorRef.current = null;
        if (topSellingTooltipFrameRef.current !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(topSellingTooltipFrameRef.current);
            topSellingTooltipFrameRef.current = null;
        }
    };


    // Full merchandise value of sales created within the selected date range.
    // Credit sales are intentionally included here when the sale is created.
    const selectedDateSales = useMemo(() => selectedDateTransactions.reduce((s, t) => s + (t.total || 0), 0), [selectedDateTransactions]);
    // number of orders/transactions
    const selectedDateOrders = selectedDateTransactions.length;
    const previousPeriod = useMemo(() => getDashboardComparisonPeriod({
        dateRange,
        customStartDate,
        customEndDate,
        specificDate,
        ...(dateRange === 'week' ? { reportingPeriod: selectedReportingPeriod } : {}),
    }), [dateRange, customStartDate, customEndDate, specificDate, selectedReportingPeriod]);
    const previousPeriodMetrics = useMemo(() => (
        previousPeriod ? getPreviousPeriodMetrics(transactions, previousPeriod) : { sales: 0, orders: 0 }
    ), [transactions, previousPeriod]);
    const salesTrend = useMemo(() => getMetricTrend(selectedDateSales, previousPeriodMetrics.sales), [selectedDateSales, previousPeriodMetrics.sales]);
    const ordersTrend = useMemo(() => getMetricTrend(selectedDateOrders, previousPeriodMetrics.orders), [selectedDateOrders, previousPeriodMetrics.orders]);

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

    const totalInventorySellingValue = useMemo(
        () => calculateActiveInventorySellingValue(processedInventory),
        [processedInventory]
    );
    const outstandingCredit = useMemo(
        () => getOutstandingCreditSummary(creditTransactions),
        [creditTransactions]
    );
    // non-sales metrics
    const totalProducts = processedInventory.length;
    const totalCategories = useMemo(
        () => getConfiguredCategoryCount(categories),
        [categories]
    );
    const totalCategoriesDisplay = isCategoriesLoading || categoriesError ? '—' : totalCategories;
    const cashierSalesTotal = useMemo(
        () => getCashierSalesTotal(cashierSelectedDateTransactions),
        [cashierSelectedDateTransactions]
    );
    const cashierTransactionCount = cashierSelectedDateTransactions.length;
    const totalProductsDisplay = isInventoryLoading ? '—' : totalProducts.toString();
    const selectedSalesDisplay = isTransactionsLoading ? '—' : formatMoney(selectedDateSales);
    const selectedOrdersDisplay = isTransactionsLoading ? '—' : selectedDateOrders.toString();
    const inventorySellingValueDisplay = isInventoryLoading ? '—' : formatMoney(totalInventorySellingValue);
    const cashierSalesDisplay = isTransactionsLoading ? '—' : formatCurrency(cashierSalesTotal);
    const cashierOrdersDisplay = isTransactionsLoading ? '—' : cashierTransactionCount.toString();
    const lowStockCountDisplay = isInventoryLoading ? '—' : String(lowStockCount);
    // Compute sales by product category (revenue = price * qty)
    const salesByCategory = useMemo(() => isSuperAdmin
        ? buildDashboardSalesByCategory(selectedDateTransactions, processedInventory)
        : [], [selectedDateTransactions, processedInventory, isSuperAdmin]);
    const categoryYAxisWidth = useMemo(() => getCategoryYAxisWidth(salesByCategory), [salesByCategory]);

    useLayoutEffect(() => {
        const container = categoryChartContainerRef.current;
        if (activeAnalyticsView !== 'categories' || !container) {
            if (categoryChartInitialDimension !== null) {
                // Reset so reopening the tab uses its current container dimensions.
                setCategoryChartInitialDimension(null);
            }
            return;
        }

        const { width, height } = container.getBoundingClientRect();
        const nextDimension = {
            width: Math.round(width),
            height: Math.round(height - CATEGORY_SCROLLBAR_CLEARANCE),
        };
        if (nextDimension.width <= 0 || nextDimension.height <= 0) return;

        // Measure before paint so Recharts never paints its default -1 dimensions.
        setCategoryChartInitialDimension((previous) => (
            previous?.width === nextDimension.width && previous?.height === nextDimension.height
                ? previous
                : nextDimension
        ));
    }, [activeAnalyticsView, categoryChartInitialDimension, salesByCategory.length]);

    const handleSalesChartPointerMove = (event) => {
        const chartBounds = event.currentTarget.getBoundingClientRect();
        const pointerX = event.clientX - chartBounds.left;
        const pointerY = event.clientY - chartBounds.top;
        const tooltipWidth = 176;
        const tooltipHeight = 78;
        const offset = 12;
        const x = pointerX + offset + tooltipWidth <= chartBounds.width
            ? pointerX + offset
            : Math.max(8, pointerX - offset - tooltipWidth);
        const y = pointerY + offset + tooltipHeight <= chartBounds.height
            ? pointerY + offset
            : Math.max(8, pointerY - offset - tooltipHeight);

        setSalesTooltipPosition({ x, y });
    };

    const clearSalesTooltipPosition = () => setSalesTooltipPosition(null);

    return (
        <div className="dashboard-shell flex flex-col p-4 gap-2 h-auto md:max-h-full md:overflow-y-auto mb-1 lg:mb-0 lg:h-full lg:min-h-0 bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 shrink-0 gap-4 md:gap-0">
                <div>
                    <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Dashboard Overview</p>
                    <p className="text-slate-500 font-normal text-[11px] md:text-xs mt-1">Welcome Back, {currentUserName}!</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative z-20">
                        <select
                            value={dateRange}
                            onChange={(e) => { clearTopSellingTooltipPosition(); setDateRange(e.target.value); }}
                            className="dashboard-date-range-select appearance-none bg-[#111827] px-3.5 py-2 rounded-lg text-xs font-medium text-white transition-colors hover:bg-slate-800 open:bg-slate-800 cursor-pointer pr-9 border border-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
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
                                onChange={(e) => { clearTopSellingTooltipPosition(); setCustomStartDate(e.target.value); }}
                                style={{ colorScheme: 'light' }}
                                className="px-2 py-1.5 rounded-md border border-gray-300 text-xs font-semibold text-gray-900 bg-white focus:ring-2 focus:ring-gray-900 outline-none cursor-pointer"
                            />
                            <span className="text-gray-500 text-xs font-semibold">to</span>
                            <input
                                type="date"
                                value={customEndDate}
                                max={new Date().toISOString().split('T')[0]}
                                onChange={(e) => { clearTopSellingTooltipPosition(); setCustomEndDate(e.target.value); }}
                                style={{ colorScheme: 'light' }}
                                className="px-2 py-1.5 rounded-md border border-gray-300 text-xs font-semibold text-gray-900 bg-white focus:ring-2 focus:ring-gray-900 outline-none cursor-pointer"
                            />
                        </div>
                    )}

                    {dateRange === 'specific_date' && (
                        <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-gray-300 shadow-sm ml-0 sm:ml-2">
                            <input
                                type="date"
                                value={specificDate}
                                max={new Date().toISOString().split('T')[0]}
                                onChange={(e) => { clearTopSellingTooltipPosition(); setSpecificDate(e.target.value); }}
                                style={{ colorScheme: 'light' }}
                                className="px-2 py-1.5 rounded-md border border-gray-300 text-xs font-semibold text-gray-900 bg-white focus:ring-2 focus:ring-gray-900 outline-none cursor-pointer"
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
                  <div className={`grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 ${(isSuperAdmin || userRole === ROLES.CASHIER) ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
                    {userRole === ROLES.CASHIER ? (
                        <>
                            <StatCard
                                title="My Sales"
                                value={cashierSalesDisplay}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 17l6-6 4 4 7-7" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 8h6v6" /></svg>}
                                color="green"
                                onClick={() => onNavigate && onNavigate('History Logs')}
                                refined
                                metricHierarchy
                                titleClassName="text-[13px]"
                                valueClassName="text-[21px] leading-tight"
                            />
                            <StatCard
                                title="My Transactions"
                                value={cashierOrdersDisplay}
                                icon={<ReceiptText />}
                                color="amber"
                                onClick={() => onNavigate && onNavigate('History Logs')}
                                refined
                                metricHierarchy
                                titleClassName="text-[13px]"
                                valueClassName="text-[21px] leading-tight"
                            />
                            <StatCard
                                title="Total Products"
                                value={totalProductsDisplay}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M3 12h18M3 17h18"/></svg>}
                                color="gray"
                                onClick={() => onNavigate && onNavigate('Product Master List')}
                                refined
                                metricHierarchy
                                titleClassName="text-[13px]"
                                valueClassName="text-[21px] leading-tight"
                            />
                            <StatCard
                                title="Total Categories"
                                value={totalCategoriesDisplay.toString()}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7h6m-6 5h6m-6 5h6m6-10h4m-4 5h4m-4 5h4"/></svg>}
                                color="indigo"
                                onClick={() => onNavigate && onNavigate('Product Master List')}
                                refined
                                metricHierarchy
                                titleClassName="text-[13px]"
                                valueClassName="text-[21px] leading-tight"
                            />
                        </>
                    ) : isSuperAdmin ? (
                        <>
                            <StatCard
                                title="Total Sales"
                                value={selectedSalesDisplay}
                                subtitle={previousPeriod ? <MetricTrendLine trend={salesTrend} label={previousPeriod.label} formatDelta={formatCurrency} /> : null}
                                subtitleClassName="whitespace-nowrap"
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 17l6-6 4 4 7-7" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 8h6v6" /></svg>}
                                color="green"
                                onClick={() => onNavigate && onNavigate('Reports')}
                                refined
                                metricHierarchy
                                titleClassName="text-[13px]"
                                valueClassName="text-[21px] leading-tight"
                            />

                            <StatCard title="Total Orders" value={selectedOrdersDisplay} subtitle={previousPeriod ? <MetricTrendLine trend={ordersTrend} label={previousPeriod.label} formatDelta={formatNumber} unit=" orders" /> : null} subtitleClassName="whitespace-nowrap" icon={<ReceiptText />} color="amber" onClick={() => onNavigate && onNavigate('History Logs')} refined metricHierarchy titleClassName="text-[13px]" valueClassName="text-[21px] leading-tight" />

                            <StatCard
                                title="Outstanding Credit"
                                value={isCreditSnapshotLoading ? '—' : formatMoney(outstandingCredit.outstandingBalance)}
                                subtitle={isCreditSnapshotLoading ? 'Loading credit summary' : `${outstandingCredit.openCount} open · ${outstandingCredit.overdueCount} overdue`}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h2m3 0h5M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" /></svg>}
                                color="gray"
                                onClick={() => onNavigate && onNavigate('Credit Transactions')}
                                accessibleLabel="View outstanding credit transactions"
                                refined
                                metricHierarchy
                                titleClassName="text-[13px]"
                                valueClassName="text-[21px] leading-tight"
                            />

                            <StatCard
                                title="Active Inventory Selling Value"
                                tooltip="Selling-price value of physical stock for active products, including reserved quantities. Not inventory cost."
                                value={inventorySellingValueDisplay}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7.5A2.5 2.5 0 015.5 5h11A2.5 2.5 0 0119 7.5V8h1.5A1.5 1.5 0 0122 9.5v7a1.5 1.5 0 01-1.5 1.5H5.5A2.5 2.5 0 013 15.5v-8z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 8v7"/><circle cx="16" cy="12.5" r="1" fill="currentColor" stroke="none"/></svg>}
                                color="indigo"
                                onClick={() => onNavigate && onNavigate('Reports')}
                                refined
                                metricHierarchy
                                titleClassName="text-[13px]"
                                valueClassName="text-[21px] leading-tight"
                            />
                        </>
                    ) : userRole === ROLES.ADMIN ? (
                        <>
                            <StatCard
                                title="Total Products"
                                value={totalProductsDisplay}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M3 12h18M3 17h18"/></svg>}
                                color="gray"
                                onClick={() => onNavigate && onNavigate('Product Master List')}
                                refined
                                metricHierarchy
                                titleClassName="text-[13px]"
                                valueClassName="text-[21px] leading-tight"
                            />
                            <StatCard
                                title="Orders"
                                value={selectedOrdersDisplay}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>}
                                color="amber"
                                onClick={() => onNavigate && onNavigate('History Logs')}
                                refined
                                metricHierarchy
                                titleClassName="text-[13px]"
                                valueClassName="text-[21px] leading-tight"
                            />
                            <StatCard
                                title="Active Inventory Selling Value"
                                tooltip="Selling-price value of physical stock for active products, including reserved quantities. Not inventory cost."
                                value={inventorySellingValueDisplay}
                                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7.5A2.5 2.5 0 015.5 5h11A2.5 2.5 0 0119 7.5V8h1.5A1.5 1.5 0 0122 9.5v7a1.5 1.5 0 01-1.5 1.5H5.5A2.5 2.5 0 013 15.5v-8z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 8v7"/><circle cx="16" cy="12.5" r="1" fill="currentColor" stroke="none"/></svg>}
                                color="indigo"
                                onClick={() => onNavigate && onNavigate('Reports')}
                                refined
                                metricHierarchy
                                titleClassName="text-[13px]"
                                valueClassName="text-[21px] leading-tight"
                            />
                        </>
                    ) : null} 
                  </div>
                {userRole === ROLES.CASHIER && (
                    <div className="flex flex-col gap-4 w-full min-w-0">
                        <div className="flex gap-4 w-full justify-between px-2 h-[60vh] min-h-0 overflow-hidden">
                            {/* top-selling and low stock side by side */}
                            <div className="w-1/2 self-start overflow-hidden rounded-xl border border-gray-100 bg-white p-0 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                <div className="flex items-center gap-2 px-4 py-3">
                                    <div className="p-1 bg-gray-100 rounded-lg text-gray-900">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                                    </div>
                                    <h3 className="text-[15px] font-semibold text-gray-900 dark:text-slate-100">My Top Products by Revenue</h3>
                                </div>
                                {topProducts.length > 0 ? (
                                    <div className="max-h-[calc(60vh-8rem)] overflow-y-auto overscroll-contain px-4 pb-1">
                                        <div className="flex items-center justify-end border-b border-slate-100 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
                                            Sales Revenue
                                        </div>
                                        <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                            {topProducts.map(product => (
                                                <div key={product.id} className="flex items-center gap-3 py-2.5">
                                                    <span className="w-5 shrink-0 text-xs font-medium tabular-nums text-slate-400 dark:text-slate-500">#{product.id}</span>
                                                    <div className="min-w-0 flex-1">
                                                    <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">{getProductDisplayName(product, categories)}</p>
                                                        {product.code && <p className="mt-0.5 truncate text-[10px] text-slate-400 dark:text-slate-500">{product.code}</p>}
                                                        <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">{formatTopProductUnits(product.unitsSoldByUnit)} sold</p>
                                                    </div>
                                                    <span className="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                                                        {formatCurrency(product.revenue)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="px-4 pb-3">
                                        <EmptyAnalyticsState
                                            title="No products sold yet"
                                            subtitle="No item sales were recorded in your transactions for the selected date range."
                                            icon={(
                                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 1.343-3 3v4h6v-4c0-1.657-1.343-3-3-3zm0 0V6m-7 13h14" />
                                                </svg>
                                            )}
                                        />
                                    </div>
                                )}
                                <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-right dark:border-slate-700 dark:bg-slate-800/50">
                                    <button type="button" onClick={onViewAllProducts} className="inline-flex items-center rounded-md px-1 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white dark:focus-visible:ring-offset-slate-900">
                                        View all <span className="ml-1" aria-hidden="true">→</span>
                                    </button>
                                </div>
                            </div>
                            <div className="bg-white p-0 rounded-xl shadow-sm border border-gray-100 flex flex-col relative overflow-hidden w-1/2 h-full min-h-0">
                                <div className="px-4 py-2 border-b border-gray-100 flex justify-between items-center shrink-0">
                                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>Low / Out of Stock</h3>
                                    <span className="bg-gray-100 text-gray-700 text-[9px] font-medium px-1.5 py-0.5 rounded-full">{lowStockCountDisplay} Items</span>
                                </div>
                                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2">
                                    {isInventoryLoading ? (
                                        <div className="flex h-full items-center justify-center text-xs text-gray-400">Loading stock status...</div>
                                    ) : lowStockItems.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-gray-400"><svg className="w-8 h-8 mb-1 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><p className="text-xs font-medium">All stocked</p></div>
                                    ) : (
                                        <div className="space-y-1">
                                            {lowStockItems.map(item => {
                                                const isOutOfStock = item.status === 'Out of Stock';
                                                return (
                                                    <div
                                                        key={item.code}
                                                        className={`flex items-center justify-between gap-2 p-1.5 rounded-lg border ${
                                                            isOutOfStock
                                                                ? 'bg-red-50 border-red-100'
                                                                : 'bg-yellow-50 border-yellow-100'
                                                        }`}
                                                    >
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-medium text-gray-900 leading-tight break-words whitespace-normal">{item.brand && item.name ? `${item.brand} ` : ''}{getProductDisplayName(item, categories)}</p>
                                                            <p className={`text-[10px] font-mono font-normal ${isOutOfStock ? 'text-red-600' : 'text-yellow-600'}`}>{item.code}</p>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <p className={`text-sm font-medium ${isOutOfStock ? 'text-red-600' : 'text-yellow-600'}`}>{item.stock}</p>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {availableAnalyticsViews.length > 0 && (
                    <div className="flex shrink-0 flex-col gap-4 mb-2">
                        <div className="grid min-h-[420px] grid-cols-1 gap-4 lg:h-[420px] lg:grid-cols-10">
                            <div className="relative flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white p-0 shadow-sm lg:col-span-7 lg:h-full">
                            <div className="flex flex-col gap-3 px-4 py-3 shrink-0 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-gray-100 rounded-lg text-gray-900">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                                    </div>
                                    <h3 className="text-base font-semibold text-gray-900">{analyticsTitle}</h3>
                                </div>
                                {availableAnalyticsViews.length > 1 && (
                                <>
                                    <div className="relative w-full max-w-52 self-end sm:hidden">
                                        <select
                                            value={activeAnalyticsView}
                                            onChange={(event) => {
                                                setAnalyticsView(event.target.value);
                                                clearSalesTooltipPosition();
                                                clearTopSellingTooltipPosition();
                                            }}
                                            aria-label="Analytics view"
                                            className="h-8 w-full appearance-none rounded-lg border border-gray-200 bg-white px-2.5 pr-8 text-xs font-medium text-slate-700 outline-none transition-colors hover:border-gray-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
                                        >
                                            {availableAnalyticsViews.map(([view, label]) => (
                                                <option key={view} value={view}>{label}</option>
                                            ))}
                                        </select>
                                        <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 9 6 6 6-6" />
                                        </svg>
                                    </div>
                                    <div className="analytics-tabs hidden items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 sm:flex" role="tablist" aria-label="Analytics view">
                                        {availableAnalyticsViews.map(([view, label]) => (
                                            <button key={view} type="button" role="tab" aria-selected={analyticsView === view} onClick={() => { setAnalyticsView(view); clearSalesTooltipPosition(); clearTopSellingTooltipPosition(); }} className={`analytics-tab rounded-md border border-transparent px-2 py-1 text-xs transition-colors ${analyticsView === view ? 'analytics-tab-active bg-gray-900 font-semibold text-white' : 'analytics-tab-inactive font-medium text-slate-600 hover:bg-gray-200/70 hover:text-slate-900'}`}>{label}</button>
                                        ))}
                                    </div>
                                </>
                                )}
                            </div>
                            <div className="analytics-chart flex-1 min-h-0 w-full pl-2 pr-0 relative overflow-hidden">
                                <div
                                    className="h-full w-full pr-2"
                                    onPointerMove={activeAnalyticsView === 'sales'
                                        ? handleSalesChartPointerMove
                                        : activeAnalyticsView === 'products' ? handleTopSellingChartPointerMove : undefined}
                                    onPointerLeave={activeAnalyticsView === 'sales'
                                        ? clearSalesTooltipPosition
                                        : activeAnalyticsView === 'products' ? clearTopSellingTooltipPosition : undefined}
                                >
                                    {activeAnalyticsView === 'sales' ? (trendData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%" debounce={300}>
                                            <LineChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                                <XAxis dataKey="name" axisLine={{ stroke: '#9CA3AF', strokeWidth: 1.5 }} tickLine={false} tick={{ fill: '#64748B', fontSize: 11, fontWeight: 500 }} dy={8} />
                                                <YAxis width={salesYAxisWidth} tickMargin={8} axisLine={false} tickLine={false} domain={[0, 'dataMax']} tick={{ fill: '#6B7280', fontSize: 10, fontWeight: 500 }} tickFormatter={formatCurrency} />
                                                <Tooltip
                                                    isAnimationActive={false}
                                                    cursor={{ stroke: '#9CA3AF', strokeWidth: 1, strokeDasharray: '3 3' }}
                                                    position={salesTooltipPosition || undefined}
                                                    wrapperStyle={{ zIndex: 20, pointerEvents: 'none' }}
                                                    content={<SalesAnalyticsTooltip />}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="sales"
                                                    {...SALES_ANALYTICS_LINE_STYLE}
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <EmptyAnalyticsState
                                            title="No sales analytics in selected range"
                                            subtitle="Adjust your date filter to generate sales trend insights."
                                            icon={(
                                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 17l6-6 4 4 7-7" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 8h6v6" />
                                                </svg>
                                            )}
                                        />
                                    )) : activeAnalyticsView === 'products' ? (
                                        <div ref={topSellingChartContainerRef} className="relative h-full w-full">
                                            <ResponsiveContainer width="100%" height="100%" onResize={handleTopSellingChartResize}>
                                            <BarChart data={topSellingBarData} layout="vertical" margin={{ top: 8, right: 104, bottom: 4, left: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10 }} tickFormatter={formatCompactCurrency} />
                                                    <YAxis type="category" dataKey="displayName" width={TOP_SELLING_LABEL_WIDTH} tickMargin={3} interval={0} axisLine={false} tickLine={false} tick={<ProductNameAxisTick products={topSellingBarData} />} />
                                                    <Tooltip
                                                        content={TopSellingProductsTooltip}
                                                        active={topSellingAnimationKey === topSellingChartKey ? false : undefined}
                                                        shared
                                                        cursor={false}
                                                        isAnimationActive={false}
                                                        allowEscapeViewBox={{ x: false, y: false }}
                                                        wrapperStyle={{ zIndex: 20, pointerEvents: 'none' }}
                                                    />
                                                    <Bar
                                                        dataKey="revenue"
                                                        fill={DASHBOARD_BAR_COLOR}
                                                        activeBar={{ fill: DASHBOARD_BAR_ACTIVE_COLOR }}
                                                        radius={[0, 4, 4, 0]}
                                                        isAnimationActive={topSellingAnimationKey === topSellingChartKey && !prefersReducedMotion && !isTopSellingChartResizing}
                                                        animationBegin={0}
                                                        animationDuration={380}
                                                        animationEasing="ease-in-out"
                                                        onAnimationEnd={handleTopSellingAnimationEnd}
                                                    >
                                                        <LabelList content={<ProductRevenueBarLabel />} />
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                            {topSellingBarData.length === 0 && (
                                                <div className="pointer-events-none absolute inset-0">
                                                    <EmptyAnalyticsState title="No top-selling data in selected range" subtitle="Try expanding the date filter to view product sales." icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" /></svg>} />
                                                </div>
                                            )}
                                        </div>
                                    ) : (salesByCategory.length > 0 ? (
                                        <div className="h-full w-full overflow-x-auto overflow-y-hidden overscroll-x-contain">
                                            <div
                                                ref={categoryChartContainerRef}
                                                className="box-border h-full w-full"
                                                style={{
                                                    minWidth: `max(100%, ${salesByCategory.length * CATEGORY_MIN_ITEM_WIDTH}px)`,
                                                    paddingBottom: CATEGORY_SCROLLBAR_CLEARANCE,
                                                }}
                                            >
                                                {categoryChartInitialDimension && (
                                                    <ResponsiveContainer width="100%" height="100%" initialDimension={categoryChartInitialDimension}>
                                                        <BarChart data={salesByCategory} margin={{ top: 14, right: 8, bottom: 0, left: 0 }}>
                                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tickMargin={2} interval={0} height={CATEGORY_AXIS_HEIGHT} tick={<CategoryAxisTick />} />
                                                            <YAxis type="number" width={categoryYAxisWidth} axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10 }} tickFormatter={formatCompactCurrency} />
                                                            <Tooltip content={<SalesByCategoryTooltip />} cursor={false} />
                                                            <Bar dataKey="value" fill={DASHBOARD_BAR_COLOR} activeBar={{ fill: DASHBOARD_BAR_ACTIVE_COLOR }} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                                                <LabelList dataKey="value" position="top" formatter={formatCurrency} fill="#334155" fontSize={9} />
                                                            </Bar>
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                )}
                                            </div>
                                        </div>
                                    ) : <EmptyAnalyticsState title="No sales yet" subtitle="No category sales in selected range." icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" /></svg>} />)}
                                </div>
                            </div>
                            </div>

                            <div className="relative flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white p-0 shadow-sm lg:col-span-3 lg:h-full">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 shrink-0">
                                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><span className="p-1.5 bg-gray-100 rounded-lg text-slate-500"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg></span>Low / Out of Stock</h3>
                                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                        <span className="whitespace-nowrap rounded-full bg-gray-900 px-1.5 py-0.5 text-[9px] font-medium text-white">{lowStockCountDisplay} Items</span>
                                        <button type="button" onClick={() => onNavigate?.('Inventory')} className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-[10px] font-medium text-slate-600 transition-colors hover:bg-gray-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1">
                                            View Inventory <span aria-hidden="true">→</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5">
                                    {isInventoryLoading ? (
                                        <div className="flex h-full items-center justify-center text-xs text-gray-400">Loading stock status...</div>
                                    ) : lowStockItems.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-gray-400"><svg className="w-8 h-8 mb-1 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><p className="text-xs font-medium">All stocked</p></div>
                                    ) : (
                                        <div className="space-y-1">
                                            {lowStockItems.map(item => {
                                                const isOutOfStock = item.status === 'Out of Stock';
                                                return (
                                                    <div
                                                        key={item.code}
                                                        className={`flex items-center justify-between gap-2 p-1 rounded-lg border ${
                                                            isOutOfStock
                                                                ? 'bg-red-50 border-red-100'
                                                                : 'bg-yellow-50 border-yellow-100'
                                                        }`}
                                                    >
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-medium text-gray-900 leading-tight break-words whitespace-normal">{item.brand && item.name ? `${item.brand} ` : ''}{getProductDisplayName(item, categories)}</p>
                                                            <p className={`text-[10px] font-mono font-normal ${isOutOfStock ? 'text-red-600' : 'text-yellow-600'}`}>{item.code}</p>
                                                        </div>
                                                        <div className="text-right shrink-0"><p className={`text-xs font-medium ${isOutOfStock ? 'text-red-600' : 'text-yellow-600'}`}>{item.stock}</p></div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                    </div>
                )}
                {availableAnalyticsViews.length > 0 && <StockMovement />}
            </div>
        </div>
    );
};

export default DashboardHome;
