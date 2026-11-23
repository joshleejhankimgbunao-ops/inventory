import React, { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { showToast } from '../utils/toastHelper';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Bar, BarChart, CartesianGrid, LabelList, LineChart, Line, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/StatCard';
import ReportRecordTable from '../components/ReportRecordTable';
import { DesktopAnalyticsChartSkeleton, DesktopErrorNotice, DesktopMetricSkeleton } from '../components/DesktopSkeletons';
import { listCreditTransactionsApi, listSpecialOrderCollectionsApi } from '../services/inventoryApi';
import { formatCurrency, formatMoney, formatNumber } from '../utils/numberFormat';
import { buildAllSalesCategoryChartData, buildTopProductsReportStats, buildTopSellingProductLegendLabels, formatReportChartPercentage } from '../utils/reportChartData';
import logo from '../assets/logo.png';
import { DASHBOARD_BAR_ACTIVE_COLOR, DASHBOARD_BAR_COLOR, SALES_ANALYTICS_LINE_STYLE } from '../utils/analyticsChart';
import { areTopSellingProductRowsStable, buildDashboardTopSellingProducts, getBoundedChartTooltipPosition } from '../utils/dashboardOverviewCharts.mjs';
import MetricTrendLine from '../components/MetricTrendLine';
import ReportDateRangeSelector from '../components/ReportDateRangeSelector';
import ReportsDateSelector from '../components/ReportsDateSelector';
import { getDashboardComparisonPeriod, getMetricTrend, getPreviousSalesReportMetrics } from '../utils/dashboardTrend';
import { getValidSales, isCreditPaymentCollectionForReporting, isImmediateSaleCollectionForReporting, isSalePhysicallyFulfilledForItemReporting } from '../../shared/saleLifecycle.mjs';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { buildInventoryReportRows, buildSalesReportRows } from '../utils/reportDetailTables';
import { sumRecognizedSalesRevenue, sumRecognizedSalesRevenueInPeriod } from '../utils/reportsSalesKpis';
import { getProductDisplayName, getTransactionProductDisplayName } from '../utils/productDisplayName';
import { drawPdfPesoAmount, drawPdfPesoHeaderSymbol, formatPdfCellText, formatPdfHeaderText, formatPdfMoneyAmount } from '../utils/reportPdfFormatting';
import {
  formatReportExportRangeLabel,
  getDefaultReportExportRange,
  getReportExportFilenameRange,
  isDateWithinReportExportRange,
  toDateInputValue,
  validateReportExportRange,
} from '../utils/reportExportRange';

const COLLECTIONS_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
let reportsCollectionsMemoryCache = null;

const getFreshReportsCollectionsCache = (userId) => {
  if (!userId || reportsCollectionsMemoryCache?.userId !== userId) return null;
  const now = Date.now();
  const cache = reportsCollectionsMemoryCache;
  if (!cache.creditFetchedAt || !cache.specialFetchedAt) return null;
  if (now - cache.creditFetchedAt > COLLECTIONS_CACHE_MAX_AGE_MS || now - cache.specialFetchedAt > COLLECTIONS_CACHE_MAX_AGE_MS) return null;
  return cache;
};

const saveReportsCollectionsCache = (userId, updates) => {
  if (!userId) return;
  const existing = reportsCollectionsMemoryCache?.userId === userId
    ? reportsCollectionsMemoryCache
    : { userId, creditTransactions: [], specialOrderCollections: [], creditFetchedAt: 0, specialFetchedAt: 0 };
  reportsCollectionsMemoryCache = { ...existing, ...updates, userId };
};

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

const TopSellingProductsTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) {
    return null;
  }

  const product = payload[0]?.payload;
  const revenue = Number(product?.revenue || 0);
  const unitsSold = formatTopReportProductUnits(product?.unitsSoldByUnit);

  return (
    <div className="flex h-[82px] w-56 flex-col justify-center gap-0.5 overflow-hidden rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <p title={product?.name || 'Unknown product'} className="truncate text-xs font-semibold leading-4 text-gray-900">{product?.name || 'Unknown product'}</p>
      {product?.code && <p title={`SKU: ${product.code}`} className="truncate text-[10px] leading-3 text-gray-500">SKU: {product.code}</p>}
      <p title={unitsSold} className="truncate text-[10px] leading-3 text-gray-600">Units Sold: {unitsSold}</p>
      <p className="truncate text-xs leading-4 text-gray-800">Sales Revenue: {formatCurrency(revenue)}</p>
    </div>
  );
};

const formatTopReportProductUnits = (unitsSoldByUnit = []) => {
  const entries = Array.isArray(unitsSoldByUnit) ? unitsSoldByUnit : [];
  if (entries.length === 0) return '0';
  return entries.map(({ quantity, sellingUnit }) => (
    `${formatNumber(quantity)}${sellingUnit ? ` ${sellingUnit}` : ''}`
  )).join(' + ');
};

const REPORTS_TOP_SELLING_LABEL_WIDTH = 164;
const REPORTS_TOP_SELLING_TOOLTIP_HEIGHT = 82;
const REPORTS_TOP_SELLING_RESIZE_SETTLE_MS = 140;
const REPORTS_CATEGORY_RESIZE_SETTLE_MS = 140;
const REPORTS_CATEGORY_MIN_ITEM_WIDTH = 104;
const REPORTS_CATEGORY_AXIS_HEIGHT = 62;

const truncateReportsProductName = (value, maxCharacters = 30) => {
  const name = String(value || '').trim() || 'Unknown product';
  return name.length > maxCharacters ? `${name.slice(0, maxCharacters - 1).trimEnd()}…` : name;
};

const ReportsTopSellingProductTick = ({ x, y, payload, products = [] }) => {
  const label = String(payload?.value || 'Unknown product');
  const skuMarker = label.lastIndexOf(' (SKU ');
  const productName = skuMarker >= 0 ? label.slice(0, skuMarker) : label;
  const skuLabel = skuMarker >= 0 ? label.slice(skuMarker + 2, -1) : '';
  const displayName = truncateReportsProductName(productName, skuLabel ? 24 : 30);
  const textX = x - 6;
  const product = products.find((entry) => entry.displayName === label);
  const unitsSold = formatTopReportProductUnits(product?.unitsSoldByUnit);

  return (
    <g>
      <title>{label}</title>
      <text x={textX} y={skuLabel ? y - 8 : y - 3} textAnchor="end" fill="#334155" fontSize={10}>
        <tspan x={textX}>{displayName}</tspan>
        {skuLabel && <tspan x={textX} dy={11} fontSize={9}>{skuLabel}</tspan>}
        <tspan x={textX} dy={11} fill="#94A3B8" fontSize={9}>{unitsSold} sold</tspan>
      </text>
    </g>
  );
};

const ReportsTopSellingValueLabel = ({ x, y, width, height, value }) => (
  <text x={x + width + 6} y={y + height / 2 + 4} fill="#334155" fontSize={10} textAnchor="start">
    {formatCurrency(value)}
  </text>
);

const ReportsTopSellingProductsChart = ({ products }) => {
  const chartContainerRef = useRef(null);
  const tooltipFrameRef = useRef(null);
  const tooltipPositionRef = useRef({ x: 0, y: 0 });
  const tooltipWidthRef = useRef(224);
  const tooltipAnchorRef = useRef(null);
  const chartSizeRef = useRef(null);
  const resizeSettleTimerRef = useRef(null);
  const isResizingRef = useRef(false);
  const previousRowsRef = useRef(null);
  const [animationKey, setAnimationKey] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));
  const chartDataKey = JSON.stringify(products.map(({ code, name, sellingUnit, revenue, unitsSoldByUnit }) => [code, name, sellingUnit, revenue, unitsSoldByUnit]));
  const chartHeight = Math.max(240, Math.min(400, products.length * 36 + 40));

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
    if (tooltipFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(tooltipFrameRef.current);
    }
    if (resizeSettleTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(resizeSettleTimerRef.current);
    }
  }, []);

  const handleAnimationEnd = () => {
    setAnimationKey((currentKey) => (currentKey === chartDataKey ? null : currentKey));
  };

  useLayoutEffect(() => {
    const previous = previousRowsRef.current;
    const dataChanged = previous?.dataKey !== chartDataKey;
    if (dataChanged) {
      const canAnimateValues = previous
        && !prefersReducedMotion
        && !isResizing
        && !isResizingRef.current
        && areTopSellingProductRowsStable(previous.rows, products);
      const nextAnimationKey = canAnimateValues ? chartDataKey : null;
      if (animationKey !== nextAnimationKey) {
        // Sync Recharts animation state before paint so values-only updates start smoothly.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAnimationKey(nextAnimationKey);
      }
    } else if ((prefersReducedMotion || isResizing) && animationKey !== null) {
      setAnimationKey(null);
    }
    previousRowsRef.current = { dataKey: chartDataKey, rows: products };
  }, [products, chartDataKey, prefersReducedMotion, isResizing, animationKey]);

  const applyTooltipPosition = () => {
    const tooltipWrapper = chartContainerRef.current?.querySelector('.recharts-tooltip-wrapper');
    if (!tooltipWrapper) return;
    const { x, y } = tooltipPositionRef.current;
    tooltipWrapper.style.transform = `translate(${x}px, ${y}px)`;
    if (tooltipWrapper.firstElementChild) tooltipWrapper.firstElementChild.style.width = `${tooltipWidthRef.current}px`;
  };

  const scheduleTooltipPosition = () => {
    if (typeof window === 'undefined') return;
    if (tooltipFrameRef.current !== null) window.cancelAnimationFrame(tooltipFrameRef.current);
    tooltipFrameRef.current = window.requestAnimationFrame(() => {
      tooltipFrameRef.current = null;
      applyTooltipPosition();
    });
  };

  const handlePointerMove = (event) => {
    const chartElement = event.currentTarget.querySelector('.recharts-wrapper');
    const chartRect = chartElement?.getBoundingClientRect?.();
    if (!chartRect || chartRect.width <= 0 || chartRect.height <= 0) {
      tooltipAnchorRef.current = null;
      return;
    }
    const tooltipWidth = Math.max(0, Math.min(224, chartRect.width - REPORTS_TOP_SELLING_LABEL_WIDTH - 16));
    const minX = Math.min(REPORTS_TOP_SELLING_LABEL_WIDTH + 8, chartRect.width - tooltipWidth - 8);
    const anchorX = event.clientX - chartRect.left;
    const anchorY = event.clientY - chartRect.top;
    tooltipAnchorRef.current = { xRatio: anchorX / chartRect.width, yRatio: anchorY / chartRect.height };
    tooltipWidthRef.current = tooltipWidth;
    Object.assign(tooltipPositionRef.current, getBoundedChartTooltipPosition({
      anchorX,
      anchorY,
      containerWidth: chartRect.width,
      containerHeight: chartRect.height,
      tooltipWidth,
      tooltipHeight: REPORTS_TOP_SELLING_TOOLTIP_HEIGHT,
      minX,
    }));
    scheduleTooltipPosition();
  };

  const handleResize = (width, height) => {
    if (width <= 0 || height <= 0) return;
    const measuredSize = { width: Math.round(width), height: Math.round(height) };
    const previousSize = chartSizeRef.current;
    if (previousSize?.width === measuredSize.width && previousSize?.height === measuredSize.height) return;
    chartSizeRef.current = measuredSize;

    if (previousSize) {
      if (!isResizingRef.current) {
        isResizingRef.current = true;
        setIsResizing(true);
        if (animationKey !== null) setAnimationKey(null);
      }
      if (resizeSettleTimerRef.current !== null) window.clearTimeout(resizeSettleTimerRef.current);
      resizeSettleTimerRef.current = window.setTimeout(() => {
        resizeSettleTimerRef.current = null;
        isResizingRef.current = false;
        setIsResizing(false);
      }, REPORTS_TOP_SELLING_RESIZE_SETTLE_MS);
    }

    const tooltipWidth = Math.max(0, Math.min(224, measuredSize.width - REPORTS_TOP_SELLING_LABEL_WIDTH - 16));
    tooltipWidthRef.current = tooltipWidth;
    const anchor = tooltipAnchorRef.current;
    if (!anchor) return;
    const minX = Math.min(REPORTS_TOP_SELLING_LABEL_WIDTH + 8, measuredSize.width - tooltipWidth - 8);
    Object.assign(tooltipPositionRef.current, getBoundedChartTooltipPosition({
      anchorX: anchor.xRatio * measuredSize.width,
      anchorY: anchor.yRatio * measuredSize.height,
      containerWidth: measuredSize.width,
      containerHeight: measuredSize.height,
      tooltipWidth,
      tooltipHeight: REPORTS_TOP_SELLING_TOOLTIP_HEIGHT,
      minX,
    }));
    scheduleTooltipPosition();
  };

  const handlePointerLeave = () => {
    tooltipAnchorRef.current = null;
    if (tooltipFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(tooltipFrameRef.current);
      tooltipFrameRef.current = null;
    }
  };

  return (
    <div
      ref={chartContainerRef}
      className="reports-inventory-analytics-chart relative mx-auto min-w-0 w-full max-w-5xl"
      style={{ height: `${chartHeight}px` }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <ResponsiveContainer width="100%" height="100%" onResize={handleResize}>
        <BarChart data={products} layout="vertical" margin={{ top: 10, right: 104, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
          <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10 }} tickFormatter={formatReportsCompactCurrency} />
          <YAxis type="category" dataKey="displayName" width={REPORTS_TOP_SELLING_LABEL_WIDTH} tickMargin={3} interval={0} axisLine={false} tickLine={false} tick={<ReportsTopSellingProductTick products={products} />} />
          <ChartTooltip
            content={<TopSellingProductsTooltip />}
            active={animationKey === chartDataKey ? false : undefined}
            shared
            cursor={false}
            isAnimationActive={false}
            allowEscapeViewBox={{ x: false, y: false }}
            wrapperStyle={{ zIndex: 20, pointerEvents: 'none' }}
          />
          <Bar
            dataKey="value"
            fill={DASHBOARD_BAR_COLOR}
            activeBar={{ fill: DASHBOARD_BAR_ACTIVE_COLOR }}
            radius={[0, 4, 4, 0]}
            maxBarSize={24}
            isAnimationActive={animationKey === chartDataKey && !prefersReducedMotion && !isResizing}
            animationBegin={0}
            animationDuration={380}
            animationEasing="ease-in-out"
            onAnimationEnd={handleAnimationEnd}
          >
            <LabelList dataKey="value" content={<ReportsTopSellingValueLabel />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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
    : '••••••';

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs font-semibold text-gray-900">{category?.name || 'Uncategorized'}</p>
      <p className="text-xs text-gray-700">Contribution: {formatReportChartPercentage(percentage)}</p>
      <p className="text-xs text-gray-700">Revenue: {salesLabel}</p>
    </div>
  );
};

const wrapReportsCategoryLabel = (value, maxCharacters = 14, maxLines = 3) => {
  const words = String(value || 'Uncategorized').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    const segments = word.length > maxCharacters
      ? word.match(new RegExp(`.{1,${maxCharacters}}`, 'g')) || [word]
      : [word];
    segments.forEach((segment) => {
      const next = current ? `${current} ${segment}` : segment;
      if (next.length > maxCharacters && current) {
        lines.push(current);
        current = segment;
      } else {
        current = next;
      }
    });
  });

  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const visibleLines = lines.slice(0, maxLines);
  const lastLine = visibleLines[maxLines - 1];
  visibleLines[maxLines - 1] = `${lastLine.slice(0, maxCharacters - 1).trimEnd()}…`;
  return visibleLines;
};

const ReportsCategoryAxisTick = ({ x, y, payload }) => {
  const label = String(payload?.value || 'Uncategorized');
  const lines = wrapReportsCategoryLabel(label);

  return (
    <g>
      <title>{label}</title>
      <text x={x} y={y + 8} textAnchor="middle" fill="#475569" fontSize={10}>
        {lines.map((line, index) => <tspan key={`${index}-${line}`} x={x} dy={index === 0 ? 0 : 11}>{line}</tspan>)}
      </text>
    </g>
  );
};

const areReportsCategoryRowsStable = (previousRows = [], nextRows = []) => (
  Array.isArray(previousRows)
  && Array.isArray(nextRows)
  && previousRows.length === nextRows.length
  && previousRows.every((category, index) => category.name === nextRows[index]?.name)
);

const formatReportsCompactCurrency = (value) => {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 1000000) return `₱${(amount / 1000000).toFixed(1)}m`;
  if (Math.abs(amount) >= 10000) return `₱${(amount / 1000).toFixed(0)}k`;
  return formatCurrency(amount);
};

const ReportsSalesByCategoryChart = ({ categories, showFinancials }) => {
  const chartSizeRef = useRef(null);
  const resizeSettleTimerRef = useRef(null);
  const previousRowsRef = useRef(null);
  const isResizingRef = useRef(false);
  const [isResizing, setIsResizing] = useState(false);
  const [animationKey, setAnimationKey] = useState(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));
  const chartDataKey = JSON.stringify(categories.map(({ name, value }) => [name, value]));
  const maxValueLabelLength = showFinancials
    ? Math.max(0, ...categories.map((category) => formatCurrency(category.value).length))
    : 3;
  const categoryWidth = Math.max(REPORTS_CATEGORY_MIN_ITEM_WIDTH, Math.ceil(maxValueLabelLength * 7 + 20));
  const chartMinWidth = categories.length * categoryWidth;
  const maxCategoryRevenue = Math.max(0, ...categories.map(({ value }) => value));
  const yAxisWidth = showFinancials
    ? Math.min(108, Math.max(70, Math.ceil(formatCurrency(maxCategoryRevenue).length * 7) + 12))
    : 36;

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
    if (resizeSettleTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(resizeSettleTimerRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    const previous = previousRowsRef.current;
    const dataChanged = previous?.dataKey !== chartDataKey;
    if (dataChanged) {
      const canAnimateValues = previous
        && !prefersReducedMotion
        && !isResizing
        && !isResizingRef.current
        && areReportsCategoryRowsStable(previous.rows, categories);
      const nextAnimationKey = canAnimateValues ? chartDataKey : null;
      if (animationKey !== nextAnimationKey) {
        // Keep Recharts animation state in sync before paint; category labels remain tied to their values.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAnimationKey(nextAnimationKey);
      }
    } else if ((prefersReducedMotion || isResizing) && animationKey !== null) {
      setAnimationKey(null);
    }
    previousRowsRef.current = { dataKey: chartDataKey, rows: categories };
  }, [categories, chartDataKey, prefersReducedMotion, isResizing, animationKey]);

  const handleAnimationEnd = () => {
    setAnimationKey((currentKey) => (currentKey === chartDataKey ? null : currentKey));
  };

  const handleResize = (width, height) => {
    if (width <= 0 || height <= 0) return;
    const measuredSize = { width: Math.round(width), height: Math.round(height) };
    const previousSize = chartSizeRef.current;
    if (previousSize?.width === measuredSize.width && previousSize?.height === measuredSize.height) return;
    chartSizeRef.current = measuredSize;

    if (!previousSize) return;
    if (!isResizingRef.current) {
      isResizingRef.current = true;
      setIsResizing(true);
      if (animationKey !== null) setAnimationKey(null);
    }
    if (resizeSettleTimerRef.current !== null) window.clearTimeout(resizeSettleTimerRef.current);
    resizeSettleTimerRef.current = window.setTimeout(() => {
      resizeSettleTimerRef.current = null;
      isResizingRef.current = false;
      setIsResizing(false);
    }, REPORTS_CATEGORY_RESIZE_SETTLE_MS);
  };

  return (
    <div className="h-[320px] min-w-0 w-full overflow-x-auto overflow-y-hidden overscroll-x-contain">
      <div className="h-full w-full" style={{ minWidth: `max(100%, ${chartMinWidth}px)` }}>
        <ResponsiveContainer width="100%" height="100%" onResize={handleResize}>
          <BarChart data={categories} margin={{ top: 26, right: 12, bottom: 2, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} interval={0} height={REPORTS_CATEGORY_AXIS_HEIGHT} tick={<ReportsCategoryAxisTick />} />
            <YAxis
              type="number"
              width={yAxisWidth}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748B', fontSize: 10 }}
              tickFormatter={(value) => (showFinancials ? formatReportsCompactCurrency(value) : '')}
            />
            <ChartTooltip
              content={<SalesByCategoryTooltip showFinancials={showFinancials} />}
              active={animationKey === chartDataKey ? false : undefined}
              shared
              cursor={false}
              isAnimationActive={false}
              allowEscapeViewBox={{ x: false, y: false }}
              wrapperStyle={{ zIndex: 20, pointerEvents: 'none' }}
            />
            <Bar
              dataKey="value"
              fill={DASHBOARD_BAR_COLOR}
              activeBar={{ fill: DASHBOARD_BAR_ACTIVE_COLOR }}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={animationKey === chartDataKey && !prefersReducedMotion && !isResizing}
              animationBegin={0}
              animationDuration={380}
              animationEasing="ease-in-out"
              onAnimationEnd={handleAnimationEnd}
            >
              <LabelList dataKey="value" position="top" formatter={(value) => (showFinancials ? formatCurrency(value) : '•••')} fill="#334155" fontSize={9} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
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

const ReportLoadingSkeleton = ({ className = '' }) => (
  <div aria-hidden="true" className={`animate-pulse motion-reduce:animate-none rounded-md bg-slate-200 dark:bg-slate-700 ${className}`} />
);

const CollectionsMetricSkeleton = () => (
  <div role="status" aria-label="Loading collections total" className="mt-1 space-y-2">
    <span className="sr-only">Loading collections</span>
    <ReportLoadingSkeleton className="h-[21px] w-32 max-w-full" />
    <ReportLoadingSkeleton className="h-3 w-28 max-w-full" />
    <ReportLoadingSkeleton className="h-3 w-36 max-w-full" />
  </div>
);

const CollectionsAnalyticsSkeleton = () => (
  <div role="status" aria-label="Loading collections analytics" className="h-[320px] min-w-0 w-full">
    <span className="sr-only">Loading collections analytics</span>
    <div className="relative flex h-full animate-pulse motion-reduce:animate-none gap-3 pb-7 pl-9 pt-3" aria-hidden="true">
      <div className="absolute inset-x-9 top-3 flex h-[calc(100%-2rem)] flex-col justify-between">
        <ReportLoadingSkeleton className="h-px w-full rounded-none" />
        <ReportLoadingSkeleton className="h-px w-full rounded-none" />
        <ReportLoadingSkeleton className="h-px w-full rounded-none" />
        <ReportLoadingSkeleton className="h-px w-full rounded-none" />
      </div>
      <div className="absolute bottom-7 left-9 right-0 top-3 overflow-hidden border-b border-l border-slate-300/70 dark:border-slate-600">
        <svg className="h-full w-full" viewBox="0 0 600 250" preserveAspectRatio="none">
          <polyline points="0,205 90,177 180,190 270,110 360,143 450,68 540,98 600,32" fill="none" stroke="currentColor" strokeWidth="4" className="text-slate-300 dark:text-slate-600" />
        </svg>
      </div>
      <div className="absolute bottom-1 left-10 right-1 flex justify-between">
        {Array.from({ length: 5 }, (_, index) => <ReportLoadingSkeleton key={`collection-tick-${index}`} className="h-2.5 w-8" />)}
      </div>
    </div>
  </div>
);

const CollectionsAnalyticsError = ({ onRetry, message = 'Collections could not be loaded.' }) => (
  <div className="flex h-[320px] min-w-0 w-full flex-col items-center justify-center gap-2 text-center" role="alert">
    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{message}</p>
    <button type="button" onClick={onRetry} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">Retry</button>
  </div>
);

const moneyCell = (value) => {
  const amount = Number(value);
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '') || !Number.isFinite(amount) ? '-' : formatMoney(amount);
};
const stockCell = (value) => value === null ? '—' : formatNumber(value);
const describeSaleDateScope = (range, specific, customStart, customEnd) => {
  const today = new Date();
  const format = (date) => toDateInputValue(date);
  if (range === 'today') return `Sale dates: ${format(today)}`;
  if (range === 'week') {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
    return `Sale dates: ${format(start)} to ${format(today)}`;
  }
  if (range === 'month') return `Sale dates: ${format(new Date(today.getFullYear(), today.getMonth(), 1))} to ${format(today)}`;
  if (range === 'year') return `Sale dates: ${format(new Date(today.getFullYear(), 0, 1))} to ${format(today)}`;
  if (range === 'specific_date') return `Sale date: ${specific || 'not selected'}`;
  if (range === 'custom') return `Sale dates: ${customStart || 'start not selected'} to ${customEnd || 'end not selected'}`;
  return 'All Sale dates';
};
const salesTableColumns = [
  { key: 'date', label: 'Transaction Date', render: (value) => value ? new Date(value).toLocaleDateString('en-PH') : '—' },
  { key: 'transactionId', label: 'Transaction ID' },
  { key: 'customer', label: 'Customer' },
  { key: 'saleType', label: 'Sales Type' },
  { key: 'total', label: 'Total Amount (₱)', align: 'right', sensitive: true, render: moneyCell },
  { key: 'paid', label: 'Amount Paid (₱)', align: 'right', sensitive: true, render: moneyCell },
  { key: 'remaining', label: 'Remaining Balance (₱)', align: 'right', sensitive: true, render: moneyCell },
  { key: 'paymentStatus', label: 'Payment Status' },
  { key: 'fulfillment', label: 'Fulfillment / Closure' },
];
const inventoryTableColumns = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Product Name' },
  { key: 'category', label: 'Category' },
  { key: 'sellingUnit', label: 'Sold By' },
  { key: 'physical', label: 'Physical Stock', align: 'right', render: stockCell },
  { key: 'reserved', label: 'Reserved Stock', align: 'right', render: stockCell },
  { key: 'available', label: 'Available Stock', align: 'right', render: stockCell },
  { key: 'status', label: 'Stock Status' },
];

const FinancialStatCard = ({ title, value, hiddenValue, showFinancials, onToggle, icon, subtitle, loading = false, desktopLoading = false, desktopError = '', error = '', onRetry, showPrivacyToggle = true }) => (
  <div className="app-dashboard-card-hover relative h-full overflow-hidden rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 md:flex md:items-center md:justify-between">
      <div className="col-span-2 min-w-0 md:col-span-1">
        <h3 className="mb-1.5 text-[13px] font-medium normal-case tracking-normal text-gray-500">{title}</h3>
        {loading ? <CollectionsMetricSkeleton /> : desktopError ? (
          <>
            <div className="break-words text-[clamp(16px,5vw,21px)] font-semibold leading-tight tracking-tight text-gray-900 [overflow-wrap:anywhere] md:text-[21px] lg:hidden">{showFinancials ? value : hiddenValue}</div>
            <DesktopErrorNotice message={desktopError} onRetry={onRetry} className="mt-1" />
          </>
        ) : desktopLoading ? (
          <>
            <div className="break-words text-[clamp(16px,5vw,21px)] font-semibold leading-tight tracking-tight text-gray-900 [overflow-wrap:anywhere] md:text-[21px] lg:hidden">{showFinancials ? value : hiddenValue}</div>
            <DesktopMetricSkeleton className="mt-1" />
          </>
        ) : <div className="break-words text-[clamp(16px,5vw,21px)] font-semibold leading-tight tracking-tight text-gray-900 [overflow-wrap:anywhere] md:text-[21px]">{showFinancials ? value : hiddenValue}</div>}
        {!loading && subtitle && <p className={`mt-0.5 text-[11px] font-medium leading-tight text-gray-500 ${desktopLoading ? 'lg:hidden' : ''}`}>{subtitle}</p>}
        {!loading && !desktopLoading && error && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-tight text-rose-700" role="alert">
            <span>{error}</span>
            {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2 hover:text-rose-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">Retry</button>}
          </div>
        )}
      </div>
      <div className="col-span-2 flex items-center justify-end gap-1.5 md:col-span-1">
        {showPrivacyToggle && <button
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
        </button>}
        <div className="p-3 rounded-xl bg-gray-900 text-white shadow-sm">
          {icon}
        </div>
      </div>
    </div>
  </div>
);

const Reports = () => {
  const { transactions = [], processedInventory: inventory = [], categories = [], isTransactionsLoading, transactionsError = '', retryTransactions = () => {}, isInventoryLoading } = useInventory() || {};
  const { userRole, ROLES, currentAuthUserId } = useAuth();
  const collectionsCacheKey = String(currentAuthUserId || '').trim();
  const initialCollectionsCache = getFreshReportsCollectionsCache(collectionsCacheKey);

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
  const [creditTransactions, setCreditTransactions] = useState(() => initialCollectionsCache?.creditTransactions || []);
  const [specialOrderCollections, setSpecialOrderCollections] = useState(() => initialCollectionsCache?.specialOrderCollections || []);
  const [creditCollectionsState, setCreditCollectionsState] = useState(() => initialCollectionsCache?.creditFetchedAt ? 'ready' : 'loading');
  const [specialCollectionsState, setSpecialCollectionsState] = useState(() => initialCollectionsCache?.specialFetchedAt ? 'ready' : 'loading');
  const [collectionsOwnerKey, setCollectionsOwnerKey] = useState(() => collectionsCacheKey);
  const [collectionFetchErrors, setCollectionFetchErrors] = useState({ credit: '', special: '' });
  const [collectionRetryVersion, setCollectionRetryVersion] = useState(0);
  const hasLoadedCreditCollectionsRef = useRef(Boolean(initialCollectionsCache?.creditFetchedAt));
  const hasLoadedSpecialCollectionsRef = useRef(Boolean(initialCollectionsCache?.specialFetchedAt));
  const creditCollectionsRequestRef = useRef(0);
  const specialCollectionsRequestRef = useRef(0);
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
    creditCollectionsRequestRef.current += 1;
    specialCollectionsRequestRef.current += 1;
    const cached = getFreshReportsCollectionsCache(collectionsCacheKey);
    const creditLoaded = Boolean(cached?.creditFetchedAt);
    const specialLoaded = Boolean(cached?.specialFetchedAt);
    setCollectionsOwnerKey(collectionsCacheKey);
    setCreditTransactions(creditLoaded ? cached.creditTransactions : []);
    setSpecialOrderCollections(specialLoaded ? cached.specialOrderCollections : []);
    setCreditCollectionsState(creditLoaded ? 'ready' : 'loading');
    setSpecialCollectionsState(specialLoaded ? 'ready' : 'loading');
    setCollectionFetchErrors({ credit: '', special: '' });
    hasLoadedCreditCollectionsRef.current = creditLoaded;
    hasLoadedSpecialCollectionsRef.current = specialLoaded;
  }, [collectionsCacheKey]);

  const retryCollections = () => {
    creditCollectionsRequestRef.current += 1;
    specialCollectionsRequestRef.current += 1;
    setCollectionFetchErrors({ credit: '', special: '' });
    if (!hasLoadedCreditCollectionsRef.current) setCreditCollectionsState('loading');
    if (!hasLoadedSpecialCollectionsRef.current) setSpecialCollectionsState('loading');
    setCollectionRetryVersion((version) => version + 1);
  };

  useEffect(() => {
    let mounted = true;

    const loadCreditTransactions = async () => {
      const requestId = ++creditCollectionsRequestRef.current;
      try {
        const rows = await listCreditTransactionsApi({ status: 'All' });
        if (mounted && requestId === creditCollectionsRequestRef.current) {
          const nextRows = Array.isArray(rows) ? rows : [];
          setCreditTransactions(nextRows);
          setCollectionsOwnerKey(collectionsCacheKey);
          hasLoadedCreditCollectionsRef.current = true;
          setCreditCollectionsState('ready');
          setCollectionFetchErrors((current) => ({ ...current, credit: '' }));
          saveReportsCollectionsCache(collectionsCacheKey, { creditTransactions: nextRows, creditFetchedAt: Date.now() });
        }
      } catch {
        if (mounted && requestId === creditCollectionsRequestRef.current) {
          if (!hasLoadedCreditCollectionsRef.current) setCreditCollectionsState('error');
          setCollectionFetchErrors((current) => ({ ...current, credit: 'Credit payment records could not be refreshed.' }));
        }
      }
    };

    const loadSpecialOrderCollections = async () => {
      const requestId = ++specialCollectionsRequestRef.current;
      try {
        const result = await listSpecialOrderCollectionsApi();
        if (mounted && requestId === specialCollectionsRequestRef.current) {
          if (!Array.isArray(result?.events)) throw new Error('Collection response is invalid.');
          setSpecialOrderCollections(result.events);
          setCollectionsOwnerKey(collectionsCacheKey);
          hasLoadedSpecialCollectionsRef.current = true;
          setSpecialCollectionsState('ready');
          setCollectionFetchErrors((current) => ({ ...current, special: '' }));
          saveReportsCollectionsCache(collectionsCacheKey, { specialOrderCollections: result.events, specialFetchedAt: Date.now() });
        }
      } catch {
        if (mounted && requestId === specialCollectionsRequestRef.current) {
          if (!hasLoadedSpecialCollectionsRef.current) setSpecialCollectionsState('error');
          setCollectionFetchErrors((current) => ({ ...current, special: 'Special Order payment records could not be refreshed.' }));
        }
      }
    };

    loadCreditTransactions();
    loadSpecialOrderCollections();
    let creditRefreshTimer = null;
    let specialRefreshTimer = null;
    const scheduleCreditRefresh = () => {
      if (creditRefreshTimer) window.clearTimeout(creditRefreshTimer);
      creditRefreshTimer = window.setTimeout(() => {
        creditRefreshTimer = null;
        void loadCreditTransactions();
      }, 80);
    };
    const scheduleSpecialRefresh = () => {
      if (specialRefreshTimer) window.clearTimeout(specialRefreshTimer);
      specialRefreshTimer = window.setTimeout(() => {
        specialRefreshTimer = null;
        void loadSpecialOrderCollections();
      }, 80);
    };
    const unsubscribeSaleCreated = subscribeRealtimeEvent('sale.created', scheduleCreditRefresh);
    const unsubscribeSaleUpdated = subscribeRealtimeEvent('sale.updated', scheduleCreditRefresh);
    const unsubscribeCredit = subscribeRealtimeEvent('credit-transactions.updated', scheduleCreditRefresh);
    const unsubscribeSpecial = subscribeRealtimeEvent('special-order.updated', scheduleSpecialRefresh);
    const unsubscribeResync = subscribeRealtimeEvent('realtime.resync', () => {
      scheduleCreditRefresh();
      scheduleSpecialRefresh();
    });

    return () => {
      mounted = false;
      if (creditRefreshTimer) window.clearTimeout(creditRefreshTimer);
      if (specialRefreshTimer) window.clearTimeout(specialRefreshTimer);
      unsubscribeSaleCreated();
      unsubscribeSaleUpdated();
      unsubscribeCredit();
      unsubscribeSpecial();
      unsubscribeResync();
    };
  }, [collectionRetryVersion, collectionsCacheKey]);

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

    return (creditTransactions || []).filter(isCreditPaymentCollectionForReporting).flatMap((creditRow) => (
      (creditRow?.paymentHistory || [])
        .filter((payment) => inRange(payment?.paymentDate))
        .map((payment) => ({
          date: payment?.paymentDate,
          amount: Number(payment?.amount || 0),
        }))
    ));
  }, [creditTransactions, dateRange, customStartDate, customEndDate, specificDate]);

  const filteredSpecialOrderPaymentEvents = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return specialOrderCollections.filter((payment) => {
      const date = new Date(payment.recordedAt);
      if (Number.isNaN(date.getTime())) return false;
      if (dateRange === 'today') return date >= today;
      if (dateRange === 'week') {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return date >= weekAgo;
      }
      if (dateRange === 'year') return date.getFullYear() === today.getFullYear();
      if (dateRange === 'month') return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
      if (dateRange === 'custom' && customStartDate && customEndDate) {
        const start = new Date(customStartDate);
        const end = new Date(customEndDate);
        end.setHours(23, 59, 59, 999);
        return date >= start && date <= end;
      }
      if (dateRange === 'specific_date' && specificDate) {
        const start = new Date(specificDate);
        const end = new Date(specificDate);
        end.setHours(23, 59, 59, 999);
        return date >= start && date <= end;
      }
      return true;
    }).map((payment) => ({ ...payment, date: payment.recordedAt, amount: payment.amountCentavos / 100 }));
  }, [specialOrderCollections, dateRange, customStartDate, customEndDate, specificDate]);

  const availableExportDates = useMemo(() => [
    ...getValidSales(transactions).map((transaction) => transaction?.date),
    ...(creditTransactions || [])
      .filter(isCreditPaymentCollectionForReporting)
      .flatMap((creditRow) => (creditRow?.paymentHistory || []).map((payment) => payment?.paymentDate)),
    ...specialOrderCollections.map((payment) => payment.recordedAt),
  ].filter(Boolean), [transactions, creditTransactions, specialOrderCollections]);

  const exportRange = useMemo(() => ({ from: exportStartDate, to: exportEndDate }), [exportStartDate, exportEndDate]);

  const exportTransactions = useMemo(() => getValidSales(transactions).filter((transaction) => (
    isDateWithinReportExportRange(transaction?.date, exportRange)
  )), [transactions, exportRange]);

  const exportCreditPaymentEvents = useMemo(() => (
    (creditTransactions || [])
      .filter(isCreditPaymentCollectionForReporting)
      .flatMap((creditRow) => (creditRow?.paymentHistory || [])
        .filter((payment) => isDateWithinReportExportRange(payment?.paymentDate, exportRange))
        .map((payment) => ({ date: payment?.paymentDate, amount: Number(payment?.amount || 0) })))
  ), [creditTransactions, exportRange]);

  const exportSpecialOrderPaymentEvents = useMemo(() => specialOrderCollections
    .filter((payment) => isDateWithinReportExportRange(payment.recordedAt, exportRange))
    .map((payment) => ({ ...payment, date: payment.recordedAt, amount: payment.amountCentavos / 100 })),
  [specialOrderCollections, exportRange]);

  const exportCollectedRevenue = useMemo(() => (
    exportTransactions
      .filter(isImmediateSaleCollectionForReporting)
      .reduce((sum, transaction) => sum + Number(transaction.total || 0), 0)
    + exportCreditPaymentEvents.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    + exportSpecialOrderPaymentEvents.reduce((sum, payment) => sum + payment.amountCentavos, 0) / 100
  ), [exportTransactions, exportCreditPaymentEvents, exportSpecialOrderPaymentEvents]);
  const exportSalesAmount = exportTransactions.reduce((sum, transaction) => sum + Number(transaction.total || 0), 0);
  const exportOrderCount = exportTransactions.length;
  const exportItemsSold = useMemo(() => exportTransactions.reduce(
    (sum, transaction) => sum + (isSalePhysicallyFulfilledForItemReporting(transaction) ? (transaction.items?.reduce((itemSum, item) => itemSum + Number(item.qty || 0), 0) || 0) : 0),
    0
  ), [exportTransactions]);

  // Recognized finalized sale value in the selected period, independent of collection timing.
  const totalSalesRevenue = sumRecognizedSalesRevenue(filteredTransactions);
  const totalOrders = filteredTransactions.length;
  const totalItemsSold = filteredTransactions.reduce(
    (sum, transaction) => sum + (isSalePhysicallyFulfilledForItemReporting(transaction) ? (transaction.items?.reduce((itemSum, item) => itemSum + (item.qty || 0), 0) || 0) : 0),
    0
  );
  const salesReportRows = useMemo(() => buildSalesReportRows(filteredTransactions, creditTransactions, specialOrderCollections), [filteredTransactions, creditTransactions, specialOrderCollections]);
  const inventoryReportRows = useMemo(() => buildInventoryReportRows(inventory, categories), [categories, inventory]);
  const inventoryCategories = useMemo(() => [...new Set(inventoryReportRows.map((row) => row.category).filter((category) => category !== '—'))].sort(), [inventoryReportRows]);
  const tableDateScope = describeSaleDateScope(dateRange, specificDate, customStartDate, customEndDate);
  const comparisonPeriod = useMemo(() => getDashboardComparisonPeriod({
    dateRange,
    customStartDate,
    customEndDate,
    specificDate,
  }), [dateRange, customStartDate, customEndDate, specificDate]);
  const previousSalesMetrics = useMemo(() => (
    comparisonPeriod
      ? getPreviousSalesReportMetrics(transactions, creditTransactions, comparisonPeriod, specialOrderCollections)
      : { collectedRevenue: 0, orders: 0, items: 0 }
  ), [transactions, creditTransactions, specialOrderCollections, comparisonPeriod]);
  const previousSalesRevenue = useMemo(() => (
    comparisonPeriod ? sumRecognizedSalesRevenueInPeriod(transactions, comparisonPeriod) : 0
  ), [transactions, comparisonPeriod]);
  const salesRevenueTrend = useMemo(() => getMetricTrend(totalSalesRevenue, previousSalesRevenue), [totalSalesRevenue, previousSalesRevenue]);
  const totalOrdersTrend = useMemo(() => getMetricTrend(totalOrders, previousSalesMetrics.orders), [totalOrders, previousSalesMetrics.orders]);
  const itemsSoldTrend = useMemo(() => getMetricTrend(totalItemsSold, previousSalesMetrics.items), [totalItemsSold, previousSalesMetrics.items]);

  const topProducts = useMemo(() => {
    const fulfilledTransactions = filteredTransactions.filter(isSalePhysicallyFulfilledForItemReporting);
    return buildTopProductsReportStats(fulfilledTransactions, inventory, categories);
  }, [categories, filteredTransactions, inventory]);

  const topProductsBarData = useMemo(() => {
    const rankedProducts = buildDashboardTopSellingProducts(
      filteredTransactions.filter(isSalePhysicallyFulfilledForItemReporting),
      inventory,
      10,
      categories
    );
    const productLabels = buildTopSellingProductLegendLabels(rankedProducts);
    const labelCounts = new Map();
    productLabels.forEach((label) => labelCounts.set(label.toLocaleLowerCase(), (labelCounts.get(label.toLocaleLowerCase()) || 0) + 1));

    return rankedProducts.map((product, index) => {
      const label = productLabels[index];
      const displayName = labelCounts.get(label.toLocaleLowerCase()) > 1
        ? `${label} · ${product.sellingUnit || (product.code ? `SKU ${product.code}` : `Item ${product.id}`)}`
        : label;
      return { ...product, displayName, value: product.revenue };
    });
  }, [categories, filteredTransactions, inventory]);

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

  const salesByCategoryChartData = useMemo(
    () => buildAllSalesCategoryChartData(salesByCategory),
    [salesByCategory]
  );

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
      .filter(isImmediateSaleCollectionForReporting)
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

    filteredSpecialOrderPaymentEvents.forEach((payment) => {
      const bucket = getBucket(payment.date);
      if (!buckets[bucket.key]) buckets[bucket.key] = { dateKey: bucket.key, name: bucket.label, sales: 0, orders: 0, sortValue: bucket.sortValue };
      buckets[bucket.key].sales += payment.amount;
    });

    return Object.values(buckets).sort((a, b) => a.sortValue - b.sortValue);
  }, [filteredTransactions, filteredCreditPaymentEvents, filteredSpecialOrderPaymentEvents, dateRange, customStartDate, customEndDate]);
  const totalCollectedRevenue = useMemo(
    () => trendData.reduce((sum, bucket) => sum + Number(bucket.sales || 0), 0),
    [trendData]
  );
  const collectedRevenueTrend = useMemo(() => getMetricTrend(totalCollectedRevenue, previousSalesMetrics.collectedRevenue), [totalCollectedRevenue, previousSalesMetrics.collectedRevenue]);

  const transactionsSnapshotPending = isTransactionsLoading && transactions.length === 0;
  const reportTransactionsPending = isTransactionsLoading && transactions.length === 0;
  const reportTransactionsError = !isTransactionsLoading && transactions.length === 0 ? transactionsError : '';
  const collectionsIdentityReady = collectionsOwnerKey === collectionsCacheKey;
  const collectionsHasInitialError = collectionsIdentityReady && (creditCollectionsState === 'error' || specialCollectionsState === 'error' || Boolean(reportTransactionsError));
  const collectionsReady = collectionsIdentityReady && creditCollectionsState === 'ready' && specialCollectionsState === 'ready' && !transactionsSnapshotPending && !reportTransactionsError;
  const reportInventoryPending = isInventoryLoading && inventory.length === 0;
  const collectionsLoading = !collectionsHasInitialError && (!collectionsIdentityReady || transactionsSnapshotPending || !collectionsReady);
  const collectionsRefreshError = collectionsIdentityReady ? collectionFetchErrors.credit || collectionFetchErrors.special || (transactions.length > 0 ? transactionsError : '') : '';
  const retryCollectionsAnalytics = () => {
    if (reportTransactionsError) retryTransactions();
    if (creditCollectionsState === 'error' || specialCollectionsState === 'error') retryCollections();
  };
  const collectionsAnalyticsState = collectionsLoading
    ? 'loading'
    : collectionsHasInitialError
      ? 'error'
      : trendData.length > 0 ? 'success' : 'empty';

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
      .filter(isImmediateSaleCollectionForReporting)
      .forEach((transaction) => addToBucket(transaction.date, transaction.total, 1));
    exportCreditPaymentEvents.forEach((payment) => addToBucket(payment.date, payment.amount, 0));
    exportSpecialOrderPaymentEvents.forEach((payment) => addToBucket(payment.date, payment.amount, 0));
    return Object.values(buckets).sort((a, b) => a.sortValue - b.sortValue);
  }, [exportTransactions, exportCreditPaymentEvents, exportSpecialOrderPaymentEvents, exportStartDate, exportEndDate]);

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
    (transaction.items || []).map((item) => `${getTransactionProductDisplayName(item, inventory, categories)} x${Number(item.qty || 0)}`).join('; '),
    Number((transaction.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0)),
    transaction.paymentMethod || '-',
    Number(transaction.total || 0),
    transaction.saleType === 'special-order' ? 'Special Order' : 'Regular POS Sale',
    transaction.saleType === 'special-order' ? (transaction.specialOrderFulfillmentStatus || 'Not recorded') : '-',
  ]));

    const inventoryDetailRows = () => inventory.map((item) => ([
    item.code || '-', getProductDisplayName(item, categories), item.category || '-', Number(item.stock || 0), Number(item.price || 0), Number(item.stock || 0) * Number(item.price || 0),
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
        ['Sales Amount', Number(exportSalesAmount)], ['Collections', Number(exportCollectedRevenue)], ['Total Orders', Number(exportOrderCount)], ['Items Issued', Number(exportItemsSold)],
      ], ['Transaction ID', 'Date', 'Customer', 'Items', 'Quantity', 'Payment Method', 'Amount', 'Sale Type', 'Fulfillment / Closure'], salesRows, [6]);
      const salesData = XLSX.utils.aoa_to_sheet([['Transaction ID', 'Date', 'Customer', 'Items', 'Quantity', 'Payment Method', 'Amount', 'Sale Type', 'Fulfillment / Closure'], ...salesRows]);
      salesData['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 22 }, { wch: 42 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 }];
      salesData['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: salesRows.length, c: 8 } }) };
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
      addTable(['Sales Amount (PHP)', 'Collections (PHP)', 'Orders', 'Items Issued'], [[formatPdfCurrency(exportSalesAmount), formatPdfCurrency(exportCollectedRevenue), String(exportOrderCount), String(exportItemsSold)]], { columnStyles: { 0: { cellWidth: printableWidth / 4, halign: 'right' }, 1: { cellWidth: printableWidth / 4, halign: 'right' }, 2: { cellWidth: printableWidth / 4, halign: 'center' }, 3: { cellWidth: printableWidth / 4, halign: 'center' } } });
      addSection('COLLECTIONS ANALYTICS');
      addTable(['Date', 'Collections (PHP)', 'Orders'], exportTrendData.map((item) => [item.name, formatPdfCurrency(item.sales), String(item.orders)]), { columnStyles: { 0: { cellWidth: 53, halign: 'left' }, 1: { cellWidth: 88, halign: 'right' }, 2: { cellWidth: 41, halign: 'center' } } });
      addSection('SALES DETAILS');
      addTable(['Transaction ID', 'Date', 'Items', 'Payment', 'Sale / Order Closure', 'Amount (PHP)'], salesDetailRows().map((row) => [row[0], row[1] ? new Date(row[1]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-', row[3], row[5], `${row[7]}${row[8] !== '-' ? ` · ${row[8]}` : ''}`, formatPdfCurrency(row[6])]), { columnStyles: { 0: { cellWidth: 29, halign: 'left' }, 1: { cellWidth: 25, halign: 'left' }, 2: { cellWidth: 53, halign: 'left' }, 3: { cellWidth: 22, halign: 'center' }, 4: { cellWidth: 27, halign: 'left' }, 5: { cellWidth: 26, halign: 'right' } } });
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
    if (mode !== 'inventory' && !collectionsReady) {
      setExportRangeError(collectionsAnalyticsState === 'loading'
        ? 'Collections are still loading. Please retry the export shortly.'
        : 'Collections could not be loaded. Retry the report before exporting.');
      return;
    }
    const hasSalesData = exportTransactions.length > 0 || exportCreditPaymentEvents.length > 0 || exportSpecialOrderPaymentEvents.length > 0;
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

  const exportVisibleTable = (kind, rows, format, selection) => {
    const columns = kind === 'sales' ? salesTableColumns : inventoryTableColumns;
    const title = kind === 'sales' ? 'Sales Transactions' : 'Inventory Stock';
    const scope = kind === 'sales' ? tableDateScope : 'Current stock snapshot';
    const filters = Object.entries(selection.filters || {}).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`);
    const details = [scope, selection.search ? `Search: ${selection.search}` : '', ...filters].filter(Boolean).join(' | ');
    const heading = columns.map((column) => column.label);
    const data = rows.map((row) => columns.map((column) => (
      column.sensitive ? formatPdfMoneyAmount(row[column.key]) : formatPdfCellText(column.render ? column.render(row[column.key], row) : row[column.key] ?? '-')
    )));
    const total = kind === 'sales' ? rows.reduce((sum, row) => sum + Number(row.total || 0), 0) : null;
    const filename = `${kind}_table_${new Date().toISOString().slice(0, 10)}`;

    if (format === 'xlsx') {
      const workbook = XLSX.utils.book_new();
      const metadata = [[title], [details], ['Matched records', rows.length]];
      if (kind === 'sales') metadata.push(['Sales amount for matched rows', total], ['Amount Paid is cumulative to date, not period collections']);
      const excelRows = rows.map((row) => columns.map((column) => typeof row[column.key] === 'number' ? row[column.key] : column.render ? column.render(row[column.key], row) : row[column.key] ?? '—'));
      const sheet = XLSX.utils.aoa_to_sheet([...metadata, [], heading, ...excelRows]);
      sheet['!cols'] = heading.map((label) => ({ wch: Math.max(16, Math.min(32, label.length + 4)) }));
      const headingRow = metadata.length + 1;
      sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headingRow, c: 0 }, e: { r: headingRow + rows.length, c: heading.length - 1 } }) };
      if (kind === 'sales') rows.forEach((_, rowIndex) => [4, 5, 6].forEach((columnIndex) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: headingRow + rowIndex + 1, c: columnIndex })];
        if (cell?.t === 'n') cell.z = '#,##0.00';
      }));
      XLSX.utils.book_append_sheet(workbook, sheet, kind === 'sales' ? 'Sales Transactions' : 'Inventory Stock');
      XLSX.writeFile(workbook, `${filename}.xlsx`);
    } else {
      const pdf = new jsPDF('l', 'mm', 'a4');
      pdf.setCharSpace(0);
      pdf.setTextColor(15, 23, 42);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.text(`Tableria La Confianza Co., Inc. - ${title}`, 12, 14);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      const detailLines = pdf.splitTextToSize(details, 270);
      pdf.text(detailLines, 12, 20);
      const summaryY = 22 + detailLines.length * 4;
      pdf.text(`Matched records: ${rows.length}`, 12, summaryY);
      if (kind === 'sales') {
        drawPdfPesoAmount(pdf, 'Sales amount:', total, 12, summaryY + 5, 8);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setCharSpace(0);
        pdf.text('Amount Paid is cumulative to date; Collections use actual payment dates.', 12, summaryY + 10);
      }
      const monetaryColumns = new Set(columns.reduce((indices, column, index) => (column.sensitive ? [...indices, index] : indices), []));
      const pdfHeading = heading.map(formatPdfHeaderText);
      autoTable(pdf, {
        startY: summaryY + (kind === 'sales' ? 14 : 4),
        margin: { left: 12, right: 12 },
        head: [pdfHeading], body: data,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak', textColor: [30, 41, 59] },
        headStyles: { fillColor: [15, 23, 42], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        showHead: 'everyPage',
        columnStyles: Object.fromEntries(columns.map((column, index) => [index, { halign: column.align === 'right' ? 'right' : 'left' }])),
        didDrawCell: (cellData) => {
          if (cellData.section !== 'head' || !monetaryColumns.has(cellData.column.index)) return;
          drawPdfPesoHeaderSymbol(pdf, cellData);
        },
      });
      pdf.save(`${filename}.pdf`);
    }
  };

  return (
        <div className="flex h-full min-h-0 flex-col gap-2">
    <div id="report-container" className="relative flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-300 bg-slate-200/50 p-2 shadow-inner md:p-4">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain">
        <div className="flex shrink-0 flex-col gap-3 border-b border-gray-200 pb-1">
          <div className="shrink-0">
            <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Reports</p>
            <p className="text-gray-500 font-medium text-[11px] md:text-xs mt-1">
              {isAdminInventoryOnly ? 'View inventory status' : 'View sales, collections, and inventory performance'}
            </p>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            {!isAdminInventoryOnly ? (
              <div className="analytics-tabs inline-flex w-fit shrink-0 rounded-lg bg-gray-100 p-1">
                <button type="button" onClick={() => { setReportType('sales'); setShowExportMenu(false); }} className={`analytics-tab rounded-md border border-transparent px-3 py-1 text-xs font-semibold transition-colors ${reportType === 'sales' ? 'analytics-tab-active bg-gray-900 text-white' : 'analytics-tab-inactive text-gray-700'}`}>Sales</button>
                <button type="button" onClick={() => { setReportType('inventory'); setShowExportMenu(false); }} className={`analytics-tab rounded-md border border-transparent px-3 py-1 text-xs font-semibold transition-colors ${reportType === 'inventory' ? 'analytics-tab-active bg-gray-900 text-white' : 'analytics-tab-inactive text-gray-700'}`}>Inventory</button>
              </div>
            ) : (
              <div className="inline-flex w-fit shrink-0 items-center rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700">
                Inventory Only
              </div>
            )}

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <ReportsDateSelector
                value={dateRange}
                onChange={setDateRange}
                specificDate={specificDate}
                onSpecificDateChange={setSpecificDate}
                customStartDate={customStartDate}
                onCustomStartDateChange={setCustomStartDate}
                customEndDate={customEndDate}
                onCustomEndDateChange={setCustomEndDate}
                className="min-w-0 flex-wrap"
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
        <div className={`grid auto-rows-fr shrink-0 gap-3 ${reportType === 'inventory' ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
          {reportType === 'sales' ? (
            <>
              <FinancialStatCard
                title="Total Sales"
                value={formatCurrency(totalSalesRevenue)}
                desktopLoading={reportTransactionsPending}
                desktopError={reportTransactionsError}
                onRetry={retryTransactions}
                hiddenValue={'P ' + '\u2022'.repeat(6)}
                showFinancials={showFinancials}
                onToggle={() => setShowFinancials((prev) => !prev)}
                subtitle={showFinancials && comparisonPeriod ? <MetricTrendLine trend={salesRevenueTrend} label={comparisonPeriod.label} formatDelta={formatCurrency} /> : null}
                icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 19h16M6 16V9m6 7V5m6 11v-5" /></svg>}
              />

              <FinancialStatCard
                title="Collections"
                value={collectionsReady ? formatCurrency(totalCollectedRevenue) : 'Unavailable'}
                hiddenValue={'P ' + '\u2022'.repeat(6)}
                showFinancials={showFinancials}
                onToggle={() => setShowFinancials((prev) => !prev)}
                loading={collectionsAnalyticsState === 'loading'}
                desktopError={collectionsHasInitialError ? collectionsRefreshError || 'Collections could not be loaded.' : ''}
                error={collectionsRefreshError}
                onRetry={retryCollectionsAnalytics}
                subtitle={collectionsReady && showFinancials && comparisonPeriod
                  ? <MetricTrendLine trend={collectedRevenueTrend} label={comparisonPeriod.label} formatDelta={formatCurrency} />
                  : null}
                icon={(
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              />

              <StatCard
                title="Total Orders"
                value={totalOrders}
                desktopLoading={reportTransactionsPending}
                desktopError={reportTransactionsError}
                onRetry={retryTransactions}
                subtitle={comparisonPeriod ? <MetricTrendLine trend={totalOrdersTrend} label={comparisonPeriod.label} formatDelta={formatNumber} unit=" orders" /> : null}
                subtitleClassName="whitespace-nowrap"
                icon={(
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z" />
                  </svg>
                )}
                metricHierarchy
                liftOnHover
                titleClassName="text-[13px]"
                valueClassName="text-[21px] leading-tight"
              />

              <StatCard
                title="Items Issued"
                value={totalItemsSold}
                desktopLoading={reportTransactionsPending}
                desktopError={reportTransactionsError}
                onRetry={retryTransactions}
                subtitle={comparisonPeriod ? <MetricTrendLine trend={itemsSoldTrend} label={comparisonPeriod.label} formatDelta={formatNumber} unit=" items" /> : null}
                subtitleClassName="whitespace-nowrap"
                icon={(
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-1.2 6.4a1 1 0 00.98 1.2H19M9 21a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z" />
                  </svg>
                )}
                metricHierarchy
                liftOnHover
                titleClassName="text-[13px]"
                valueClassName="text-[21px] leading-tight"
              />
            </>
          ) : (
            <>
              <StatCard
                title="Total Products"
                value={inventory.length}
                desktopLoading={reportInventoryPending}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
                metricHierarchy
                liftOnHover
                mobileMetricStack
                titleClassName="text-[13px]"
                valueClassName="text-[21px] leading-tight"
              />

              <StatCard
                title="Low Stock Items"
                value={lowStockCount}
                desktopLoading={reportInventoryPending}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
                metricHierarchy
                liftOnHover
                mobileMetricStack
                titleClassName="text-[13px]"
                valueClassName="text-[21px] leading-tight"
              />

              <StatCard
                title="Out of Stock"
                value={outOfStockCount}
                desktopLoading={reportInventoryPending}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>}
                metricHierarchy
                liftOnHover
                mobileMetricStack
                titleClassName="text-[13px]"
                valueClassName="text-[21px] leading-tight"
              />

              <FinancialStatCard
                title="Inventory Value"
                value={formatCurrency(inventoryValue)}
                desktopLoading={reportInventoryPending}
                hiddenValue="P ••••••"
                showFinancials={showFinancials}
                onToggle={() => setShowFinancials((prev) => !prev)}
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              />
            </>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-1 gap-4 lg:grid-cols-10">
            <div className={`app-dashboard-card-hover analytics-chart relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm ${reportType === 'sales' ? 'min-h-[400px] lg:col-span-5' : reportType === 'inventory' ? 'reports-inventory-analytics-card min-h-[400px] lg:col-span-10' : 'min-h-[400px] lg:col-span-7'}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 bg-gray-100 rounded-lg text-gray-900"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg></div>
                <h3 className="text-lg font-semibold text-gray-800">{reportType === 'sales' ? 'Collections Analytics' : 'Top Products by Revenue'}</h3>
              </div>

              {reportType === 'inventory' ? (
                <>
                {reportTransactionsPending && <DesktopAnalyticsChartSkeleton type="bar" className="h-[400px]" />}
                {reportTransactionsError && <DesktopErrorNotice message={reportTransactionsError} onRetry={retryTransactions} className="min-h-[280px] flex-1 flex-col justify-center text-center" />}
                {topProductsBarData.length > 0 ? (
                  <div className="flex min-h-[240px] min-w-0 flex-1 items-center justify-center lg:min-h-0">
                    <ReportsTopSellingProductsChart products={topProductsBarData} />
                  </div>
                ) : (
                  <div className={`flex-1 ${reportTransactionsPending || reportTransactionsError ? 'lg:hidden' : ''}`}>
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
                )}
                </>
              ) : reportType === 'sales' ? (
                  collectionsAnalyticsState === 'loading' ? <CollectionsAnalyticsSkeleton /> : collectionsAnalyticsState === 'error' ? <CollectionsAnalyticsError onRetry={retryCollectionsAnalytics} message={collectionsRefreshError || 'Collections could not be loaded.'} /> : trendData.length > 0 ? (
                  <div className="h-[320px] min-w-0 w-full">
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
                          {...SALES_ANALYTICS_LINE_STYLE}
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
            <div className="app-dashboard-card-hover analytics-chart relative flex min-h-[400px] min-w-0 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm lg:col-span-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="rounded-lg bg-gray-100 p-1.5 text-gray-900">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-800">Sales by Category</h3>
              </div>

              {reportTransactionsPending && <DesktopAnalyticsChartSkeleton type="vertical-bar" />}
              {reportTransactionsError && <DesktopErrorNotice message={reportTransactionsError} onRetry={retryTransactions} className="min-h-[280px] flex-1 flex-col justify-center text-center" />}
              {salesByCategoryChartData.length > 0 ? (
                <ReportsSalesByCategoryChart categories={salesByCategoryChartData} showFinancials={showFinancials} />
              ) : (
                <div className={`h-[320px] lg:min-h-0 lg:flex-1 lg:h-auto ${reportTransactionsPending || reportTransactionsError ? 'lg:hidden' : ''}`}>
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
        {reportType === 'sales' ? (
          <ReportRecordTable
            title="Sales Transactions"
            note="One row per Sale. Amount Paid is cumulative to date; Collections above use actual payment dates. Inventory fulfillment and administrative order closure are separate from Sale recording."
            rows={salesReportRows}
            columns={salesTableColumns}
            mobileCardTitleKey="transactionId"
            mobileCardSubtitleKey="date"
            mobileCardStatusKey="paymentStatus"
            showFinancials={showFinancials}
            filters={[
              { key: 'saleType', label: 'sales types', options: ['Cash', 'Credit', 'Special Order'] },
              { key: 'paymentStatus', label: 'payment statuses', options: [...new Set(salesReportRows.map((row) => row.paymentStatus))].sort() },
            ]}
            loading={isTransactionsLoading || collectionsLoading}
            desktopLoading={reportTransactionsPending}
            desktopError={reportTransactionsError}
            error={reportTransactionsError}
            onRetry={retryTransactions}
            onExport={(rows, format, selection) => exportVisibleTable('sales', rows, format, selection)}
          />
        ) : (
          <ReportRecordTable
            title="Inventory Stock"
            note="Current physical, reserved, and available-to-sell quantities. Special Order stock is deducted at authorized handover."
            rows={inventoryReportRows}
            columns={inventoryTableColumns}
            mobileCardTitleKey="name"
            mobileCardSubtitleKey="sku"
            mobileCardStatusKey="status"
            filters={[
              { key: 'category', label: 'categories', options: inventoryCategories },
              { key: 'status', label: 'stock statuses', options: [...new Set(inventoryReportRows.map((row) => row.status))].sort() },
            ]}
            loading={isInventoryLoading}
            desktopLoading={reportInventoryPending}
            error=""
            onExport={(rows, format, selection) => exportVisibleTable('inventory', rows, format, selection)}
          />
        )}
      </div>
    </div>
    {showExportMenu && (
      <div
        className="app-modal-backdrop pdf-exclude fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
        role="presentation"
      >
        <div role="dialog" aria-modal="true" aria-labelledby="export-report-title" onClick={(event) => event.stopPropagation()} className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200/80 bg-slate-50 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] dark:border-slate-700/80 dark:bg-[#24262a] dark:shadow-[0_20px_50px_-24px_rgba(0,0,0,0.6)]">
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
