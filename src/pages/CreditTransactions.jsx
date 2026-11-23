import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { showToast } from '../utils/toastHelper';
import { showPageLoadError } from '../utils/pageLoadError';
import ContextualEmptyState from '../components/ContextualEmptyState';
import { useAuth } from '../context/AuthContext';
import {
    getCreditTransactionByIdApi,
    getCreditTransactionsSummaryApi,
    listCreditTransactionsApi,
    recordCreditPaymentApi,
    markCreditTransactionPaidApi,
    getCreditTransactionProofApi,
    getCreditPaymentProofApi,
    getCreditCancellationProofApi,
    extendCreditTransactionTermApi,
    cancelCreditTransactionApi,
} from '../services/inventoryApi';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { getTransactionProductDisplayName } from '../utils/productDisplayName';
import { useInventory } from '../context/InventoryContext';
import Pagination from '../components/Pagination';
import IdentifierChip from '../components/IdentifierChip';
import OrderConfirmationModal from '../components/OrderConfirmationModal';
import TableActionButton from '../components/TableActionButton';
import RecordActionIcon from '../components/RecordActionIcon';
import EvidenceUploadField from '../components/EvidenceUploadField';
import CustomerOverdueHistoryModal from '../components/CustomerOverdueHistoryModal';
import { formatCurrency, formatNumber } from '../utils/numberFormat';
import { getCreditDueStatus } from '../utils/creditDueStatus';
import { getActorDisplayName } from '../utils/actorDisplay';
import { getAttentionRowClass } from '../utils/tableStatusStyle';
import { normalizeHumanReadable } from '../utils/textNormalization';
import { createClientRequestId } from '../utils/clientRequestId';
import { buildCreditConfirmation } from '../utils/creditConfirmation';
import { setFormValidationErrors } from '../utils/formValidationNavigation';
import {
    isWholeNumberInput,
    preventInvalidWholeNumberKeyDown,
    preventInvalidWholeNumberPaste,
    sanitizeWholeNumberInput,
} from '../utils/numericInput';
const STATUS_OPTIONS = ['All', 'Unpaid', 'Near Due', 'Due Today', 'Overdue', 'Paid', 'Cancelled'];

const statusBadgeClass = (status) => {
    const value = String(status || '').toLowerCase();
    if (value === 'paid') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (value === 'near due') return 'bg-amber-100 text-amber-900 border-amber-300';
    if (value === 'due today') return 'bg-orange-100 text-orange-800 border-orange-200';
    if (value === 'overdue') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (value === 'cancelled') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (value === 'partially paid') return 'bg-amber-100 text-amber-900 border-amber-300';
    if (value === 'unpaid') return 'bg-amber-100 text-amber-900 border-amber-300';
    return 'bg-slate-100 text-slate-700 border-slate-200';
};

const formatMoney = formatCurrency;

const toDateInputValue = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
};

const formatDateShort = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString();
};

const getOrderDate = (record) => record?.orderId?.createdAt || record?.createdAt || null;

const getDatePaid = (record) => {
    if (String(record?.status || '').toLowerCase() !== 'paid') return null;

    const payments = Array.isArray(record?.paymentHistory) ? record.paymentHistory : [];
    return payments.length > 0 ? payments[payments.length - 1]?.paymentDate || null : null;
};

const getCreditPaymentMode = (record) => {
    const payments = Array.isArray(record?.paymentHistory) ? record.paymentHistory : [];
    const latestPaymentMethod = String(payments[payments.length - 1]?.method || '').trim();
    if (latestPaymentMethod) return latestPaymentMethod;

    const explicitMode = String(record?.creditPaymentMode || '').trim();
    if (explicitMode) return explicitMode;

    const modeMatch = String(record?.orderId?.notes || '').trim().match(/(?:preferred mode of payment|down payment method):\s*(.+)$/i);
    return modeMatch ? String(modeMatch[1] || '').trim() : record?.orderId?.paymentMethod || '-';
};

const getDownPayment = (record) => {
    const event = (record?.paymentHistory || []).find((payment) => payment?.type === 'down_payment');
    const amount = Number(event?.amount ?? record?.downPaymentAmount ?? 0);
    return Number.isFinite(amount) && amount > 0 ? { amount, method: String(event?.method || record?.creditPaymentMode || '').trim() } : null;
};

const getPaymentEventLabel = (record, payment, index) => {
    if (payment?.type === 'down_payment') return 'Down Payment';
    const payments = Array.isArray(record?.paymentHistory) ? record.paymentHistory : [];
    if (String(record?.status || '').toLowerCase() === 'paid' && index === payments.length - 1) return 'Final Payment';
    return 'Partial Payment';
};

const getCreditProcessorDisplayName = (record) => getActorDisplayName(
    record?.cashierUser,
    record?.cashierName,
    '-'
);

const startOfDay = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const CREDIT_PAYMENT_MODES = ['cash', 'gcash', 'cheque', 'bank transfer', 'other'];
const MONEY_INPUT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

const CreditTransactions = () => {
    const [searchParams] = useSearchParams();
    const { processedInventory = [], categories: productCategories = [] } = useInventory();
    const { appSettings } = useAuth();
    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState({
        totalCreditReceivables: 0,
        unpaidAccounts: 0,
        partiallyPaidAccounts: 0,
        paidAccounts: 0,
        overdueAccounts: 0,
    });
    const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
    const [statusFilter, setStatusFilter] = useState('All');
    const [customerFilter, setCustomerFilter] = useState('ALL');
    const [processedByFilter, setProcessedByFilter] = useState('ALL');
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
    const [dateRange, setDateRange] = useState('all');
    const [specificDate, setSpecificDate] = useState('');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    const [sortOrder, setSortOrder] = useState('desc');
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const creditDataRequestRef = useRef(0);
    const [isCustomerOverdueHistoryOpen, setIsCustomerOverdueHistoryOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const [selectedRecord, setSelectedRecord] = useState(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [creditConfirmationView, setCreditConfirmationView] = useState(null);

    const [isMarkPaidModalOpen, setIsMarkPaidModalOpen] = useState(false);
    const [markPaidModalMode, setMarkPaidModalMode] = useState('markPaid');
    const [markPaidTarget, setMarkPaidTarget] = useState(null);
    const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
    const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
    const [markPaidForm, setMarkPaidForm] = useState({
        transactionId: '',
        customerName: '',
        amount: '',
        termDays: 0,
        extensionDays: '',
        maxExtensionDays: 0,
        transactionDate: '',
        paymentDate: '',
        paymentMethod: 'cash',
        reference: '',
        note: '',
        cancelReason: '',
    });
    const [isSavingMarkPaid, setIsSavingMarkPaid] = useState(false);
    const [isMarkPaidPaymentMethodOpen, setIsMarkPaidPaymentMethodOpen] = useState(false);
    const [isSavingExtensionOnly, setIsSavingExtensionOnly] = useState(false);
    const creditMutationInFlightRef = useRef(false);
    const markPaidRequestIdRef = useRef('');
    const [isCancellingCredit, setIsCancellingCredit] = useState(false);
    const [proofFiles, setProofFiles] = useState([]);
    const [cancelProofFiles, setCancelProofFiles] = useState([]);
    const [proofError, setProofError] = useState('');
    const [proofLightbox, setProofLightbox] = useState(null);
    const markPaidPaymentMethodRef = useRef(null);
    const customMarkPaidPaymentMethodInputRef = useRef(null);
    const extensionMax = Number(markPaidForm.maxExtensionDays || 0);
    const isExtensionUnavailable = extensionMax <= 0;
    const clampExtensionDays = (value) => {
        const sanitizedValue = sanitizeWholeNumberInput(value);
        if (!sanitizedValue) return '';
        return String(Math.min(extensionMax, Number(sanitizedValue)));
    };
    const parsedDueDate = markPaidTarget?.dueDate ? startOfDay(markPaidTarget.dueDate) : null;
    const hasValidDueDate = Boolean(parsedDueDate);
    const hasExtensionInput = String(markPaidForm.extensionDays || '').trim() !== '';
    const hasValidExtensionFormat = !hasExtensionInput || isWholeNumberInput(markPaidForm.extensionDays);
    const extensionDays = hasExtensionInput && hasValidExtensionFormat ? Number(markPaidForm.extensionDays) : 0;
    const isExtensionOutOfRange = !hasValidExtensionFormat || extensionDays > extensionMax;
    const extensionInputError = !hasValidDueDate
        ? 'Due date is missing. Unable to compute extension.'
        : (isExtensionUnavailable
            ? ''
            : (!hasValidExtensionFormat
                ? 'Enter a valid number of extension days.'
                : (extensionDays < 0
                    ? 'Extension days cannot be negative.'
                    : (extensionDays === 0 && markPaidModalMode === 'extendOnly'
                        ? 'Enter extension days greater than 0.'
                        : (extensionDays > extensionMax
                            ? `Extension exceeds allowed limit. Max is ${extensionMax} day(s).`
                            : '')))));
    const canSaveExtensionOnly = extensionDays > 0 && !isExtensionOutOfRange && !extensionInputError;
    const previewDueDate = hasValidDueDate
        ? new Date(parsedDueDate.getTime() + (extensionDays * 24 * 60 * 60 * 1000))
        : null;
    const extensionHelperMessage = extensionInputError
        || (isExtensionUnavailable
            ? 'Term already reached the 60-day limit. No further extension allowed.'
            : '');
    const extensionHelperClass = extensionInputError
        ? (extensionInputError === 'Enter extension days greater than 0.'
            ? 'text-gray-900 font-semibold'
            : 'text-rose-500 font-semibold')
        : 'text-gray-400';
    const paymentAmountText = String(markPaidForm.amount || '').trim();
    const paymentAmount = MONEY_INPUT_PATTERN.test(paymentAmountText) ? Number(paymentAmountText) : NaN;
    const outstandingBalance = Number(markPaidTarget?.remainingBalance || 0);
    const paymentAmountError = markPaidModalMode === 'markPaid' && (
        !Number.isFinite(paymentAmount) || paymentAmount <= 0
            ? 'Enter an amount greater than ₱0.00 with no more than two decimal places.'
            : markPaidTarget?.collectionSource === 'special_order_ledger' && paymentAmount !== outstandingBalance
                ? 'The linked Special Order balance must be settled in one final payment.'
            : paymentAmount > outstandingBalance
                ? 'Payment cannot exceed the remaining balance.'
                : ''
    );
    const balanceAfterPayment = paymentAmountError || !Number.isFinite(paymentAmount)
        ? null
        : Math.max(0, outstandingBalance - paymentAmount);
    const selectedDisplayStatus = selectedRecord ? getCreditDueStatus(selectedRecord) : '';
    const selectedCreditConfirmation = selectedRecord ? buildCreditConfirmation(selectedRecord) : null;
    const selectedPaymentStatus = ['Paid', 'Cancelled', 'Overdue'].includes(selectedDisplayStatus)
        ? selectedDisplayStatus
        : Number(selectedRecord?.amountPaid || 0) > 0 ? 'Partially Paid' : selectedDisplayStatus;
    const selectedLegacyProofIsInHistory = Boolean(selectedRecord?.proofOfPayment && (selectedRecord.paymentHistory || []).some((payment) => (
        [...(Array.isArray(payment?.proofs) ? payment.proofs : []), payment?.proof]
            .some((proof) => proof?.storageKey && proof.storageKey === selectedRecord.proofOfPayment.storageKey)
    )));

    useEffect(() => () => {
        if (proofLightbox?.url) URL.revokeObjectURL(proofLightbox.url);
    }, [proofLightbox]);

    useEffect(() => {
        if (!isMarkPaidPaymentMethodOpen) return undefined;

        const closeWhenFocusLeaves = (target) => {
            if (!markPaidPaymentMethodRef.current?.contains(target)) {
                setIsMarkPaidPaymentMethodOpen(false);
            }
        };
        const handlePointerDown = (event) => closeWhenFocusLeaves(event.target);
        const handleFocusIn = (event) => closeWhenFocusLeaves(event.target);
        const handleKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            setIsMarkPaidPaymentMethodOpen(false);
            markPaidPaymentMethodRef.current?.querySelector('button')?.focus();
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isMarkPaidPaymentMethodOpen]);

    const normalizeCreditPaymentMode = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return 'other';
        if (raw.startsWith('other')) return 'other';
        const exactMatch = CREDIT_PAYMENT_MODES.find((mode) => mode === raw);
        if (exactMatch) return exactMatch;
        const containsMatch = CREDIT_PAYMENT_MODES.find((mode) => raw.includes(mode));
        return containsMatch || 'other';
    };

    const formatPaymentModeLabel = (mode) => {
        if (mode === 'cash') return 'Cash';
        if (mode === 'gcash') return 'GCash';
        if (mode === 'bank transfer') return 'Bank Transfer';
        if (mode === 'cheque') return 'Cheque';
        if (mode === 'other') return 'Other';
        return mode;
    };

    const focusCustomMarkPaidPaymentMethodInput = () => {
        window.requestAnimationFrame(() => {
            const input = customMarkPaidPaymentMethodInputRef.current;
            if (!input) return;

            input.focus({ preventScroll: true });
            if (input.value) input.select();

            const inputBounds = input.getBoundingClientRect();
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            if (inputBounds.top < 0 || inputBounds.bottom > viewportHeight) {
                input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    };

    const loadData = React.useCallback(async () => {
        const requestId = ++creditDataRequestRef.current;
        setIsLoading(true);
        setLoadError('');
        try {
            const [nextSummary, nextRows] = await Promise.all([
                getCreditTransactionsSummaryApi(),
                listCreditTransactionsApi({ status: 'All', search: searchQuery }),
            ]);

            if (requestId !== creditDataRequestRef.current) return;
            setSummary(nextSummary || {
                totalCreditReceivables: 0,
                unpaidAccounts: 0,
                partiallyPaidAccounts: 0,
                paidAccounts: 0,
                overdueAccounts: 0,
            });
            setRows(Array.isArray(nextRows) ? nextRows : []);
        } catch (error) {
            if (requestId !== creditDataRequestRef.current) return;
            setLoadError(error?.message || 'Unable to load credit transactions.');
            showPageLoadError(showToast, error, 'credit-load');
        } finally {
            if (requestId === creditDataRequestRef.current) setIsLoading(false);
        }
    }, [searchQuery]);

    const resetCreditFilters = () => {
        setSearchQuery('');
        setStatusFilter('All');
        setCustomerFilter('ALL');
        setProcessedByFilter('ALL');
        setDateRange('all');
        setSpecificDate('');
        setCustomStartDate('');
        setCustomEndDate('');
        setSortOrder('desc');
    };
    const hasCreditFilters = Boolean(searchQuery.trim())
        || statusFilter !== 'All'
        || customerFilter !== 'ALL'
        || processedByFilter !== 'ALL'
        || dateRange !== 'all'
        || Boolean(specificDate || customStartDate || customEndDate);
    const creditEmptyState = loadError
        ? { title: 'Credit transactions unavailable', description: 'Credit transactions could not be loaded. Please try again.', actionLabel: 'Retry', onAction: () => { void loadData(); } }
        : hasCreditFilters
            ? { title: 'No matching results', description: 'Try a different search or filter.', actionLabel: 'Clear Filters', onAction: resetCreditFilters }
            : { title: 'No credit transactions yet', description: 'Recorded credit orders will appear here.' };

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        let refreshTimer = null;
        const scheduleRefresh = () => {
            if (refreshTimer) window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(() => {
                refreshTimer = null;
                void loadData();
            }, 80);
        };
        const events = ['credit-transactions.updated', 'sale.created', 'sale.updated', 'realtime.resync'];
        const unsubscribe = events.map((event) => subscribeRealtimeEvent(event, scheduleRefresh));
        return () => {
            if (refreshTimer) window.clearTimeout(refreshTimer);
            unsubscribe.forEach((stop) => stop());
            creditDataRequestRef.current += 1;
        };
    }, [loadData]);

    const customerOptions = useMemo(() => {
        const unique = new Set(
            rows
                .map((row) => String(row?.customerName || '').trim())
                .filter(Boolean)
        );
        return ['ALL', ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
    }, [rows]);

    const processedByOptions = useMemo(() => {
        const unique = new Set(
            rows
                .map((row) => getCreditProcessorDisplayName(row))
                .filter(Boolean)
        );
        return ['ALL', ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
    }, [rows]);

    const visibleRows = useMemo(() => {
        const query = String(searchQuery || '').trim().toLowerCase();
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        const filtered = rows.filter((row) => {
            const customerName = String(row?.customerName || '').trim();
            const customer = customerName.toLowerCase();
            const creditId = String(row?.creditTransactionId || '').toLowerCase();
            const orderRef = String(row?.orderReference || '').toLowerCase();
            const displayStatus = getCreditDueStatus(row, today);

            if (statusFilter !== 'All' && displayStatus !== statusFilter) {
                return false;
            }

            if (customerFilter !== 'ALL' && customerName !== customerFilter) {
                return false;
            }

            if (processedByFilter !== 'ALL') {
                const cashierName = getCreditProcessorDisplayName(row);
                if (cashierName !== processedByFilter) {
                    return false;
                }
            }

            const createdAt = new Date(row?.createdAt || row?.date || 0);
            let matchesDate = true;
            if (dateRange === 'today') {
                matchesDate = createdAt >= todayStart;
            } else if (dateRange === 'week') {
                const weekAgo = new Date(todayStart);
                weekAgo.setDate(weekAgo.getDate() - 7);
                matchesDate = createdAt >= weekAgo;
            } else if (dateRange === 'month') {
                const monthAgo = new Date(todayStart);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                matchesDate = createdAt >= monthAgo;
            } else if (dateRange === 'specific_date' && specificDate) {
                const targetDate = new Date(specificDate);
                const endTarget = new Date(specificDate);
                endTarget.setHours(23, 59, 59, 999);
                matchesDate = createdAt >= targetDate && createdAt <= endTarget;
            } else if (dateRange === 'custom' && customStartDate && customEndDate) {
                const start = new Date(customStartDate);
                const end = new Date(customEndDate);
                end.setHours(23, 59, 59, 999);
                matchesDate = createdAt >= start && createdAt <= end;
            }

            if (!matchesDate) return false;
            if (!query) return true;

            return customer.includes(query) || creditId.includes(query) || orderRef.includes(query);
        });

        const withMeta = filtered.map((row, index) => {
            const parsedTime = new Date(row?.createdAt || row?.date || 0).getTime();
            return {
                row,
                index,
                time: Number.isNaN(parsedTime) ? null : parsedTime,
            };
        });

        withMeta.sort((a, b) => {
            if (a.time !== null && b.time !== null && a.time !== b.time) {
                return sortOrder === 'desc' ? b.time - a.time : a.time - b.time;
            }
            if (a.time !== null && b.time === null) return -1;
            if (a.time === null && b.time !== null) return 1;
            return sortOrder === 'desc' ? b.index - a.index : a.index - b.index;
        });

        return withMeta.map((entry) => entry.row);
    }, [rows, searchQuery, statusFilter, customerFilter, processedByFilter, dateRange, specificDate, customStartDate, customEndDate, sortOrder]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, statusFilter, customerFilter, processedByFilter, dateRange, specificDate, customStartDate, customEndDate, sortOrder]);

    const totalPages = Math.ceil(visibleRows.length / itemsPerPage);
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentRows = visibleRows.slice(indexOfFirstItem, indexOfLastItem);
    const hasResults = visibleRows.length > 0;
    const displayStart = hasResults ? indexOfFirstItem + 1 : 0;
    const displayEnd = hasResults ? Math.min(indexOfLastItem, visibleRows.length) : 0;

    useEffect(() => {
        setCurrentPage((previous) => Math.min(previous, Math.max(totalPages, 1)));
    }, [totalPages]);

    const handleOpenDetails = async (row) => {
        try {
            setCreditConfirmationView(null);
            const detail = await getCreditTransactionByIdApi(row._id);
            setSelectedRecord(detail);
            setIsDetailsOpen(true);
        } catch (error) {
            showPageLoadError(showToast, error, 'credit-details');
        }
    };

    const handleViewConfirmation = () => {
        const confirmation = buildCreditConfirmation(selectedRecord);
        if (!confirmation) {
            showToast('Confirmation Unavailable', 'The saved order confirmation is not available for this transaction.', 'error', 'credit-confirmation-unavailable');
            return;
        }
        setCreditConfirmationView(confirmation);
    };

    const closeProofLightbox = () => {
        setProofLightbox(null);
    };

    const handleViewProof = async () => {
        if (!selectedRecord?._id || !selectedRecord?.proofOfPayment) return;

        try {
            const imageBlob = await getCreditTransactionProofApi(selectedRecord._id);
            setProofLightbox({
                url: URL.createObjectURL(imageBlob),
                fileName: selectedRecord.proofOfPayment.fileName || 'Proof of Payment',
            });
        } catch (error) {
            showToast('Proof Unavailable', error.message || 'Unable to load Proof of Payment.', 'error', 'credit-proof-view');
        }
    };

    const handleViewPaymentProof = async (payment, index = 0) => {
        const proof = payment?.proofs?.[index] || (index === 0 ? payment?.proof : null);
        if (!selectedRecord?._id || !proof?.storageKey || !payment?.clientRequestId) return;

        try {
            const imageBlob = await getCreditPaymentProofApi(selectedRecord._id, payment.clientRequestId, index);
            setProofLightbox({
                url: URL.createObjectURL(imageBlob),
                fileName: proof.fileName || 'Proof of Payment',
            });
        } catch (error) {
            showToast('Proof Unavailable', error.message || 'Unable to load Proof of Payment.', 'error', 'credit-payment-proof-view');
        }
    };

    const handleViewCancellationProof = async (index) => {
        if (!selectedRecord?._id) return;
        try {
            const imageBlob = await getCreditCancellationProofApi(selectedRecord._id, index);
            setProofLightbox({
                url: URL.createObjectURL(imageBlob),
                fileName: selectedRecord.cancelProofs?.[index]?.fileName || 'Proof of Cancellation',
            });
        } catch (error) {
            showToast('Proof Unavailable', error.message || 'Unable to load Proof of Cancellation.', 'error', 'credit-cancel-proof-view');
        }
    };

    const clearProofSelection = () => {
        setProofFiles([]);
        setProofError('');
    };

    const handleOpenMarkPaidModal = (row, mode = 'markPaid') => {
        const existingPaymentMethod = String(row?.creditPaymentMode || '').trim();
        const normalizedPaymentMethod = normalizeCreditPaymentMode(existingPaymentMethod);
        markPaidRequestIdRef.current = '';
        setMarkPaidModalMode(mode);
        setMarkPaidTarget(row);
        setIsCancelModalOpen(false);
        setIsCancelConfirmOpen(false);
        setIsMarkPaidPaymentMethodOpen(false);
        clearProofSelection();
        setCancelProofFiles([]);
        setMarkPaidForm({
            transactionId: row?.creditTransactionId || '',
            customerName: row?.customerName || '',
            amount: Number(row?.remainingBalance || 0).toFixed(2),
            termDays: Number(row?.termDays || 0),
            extensionDays: mode === 'extendOnly' ? '' : '0',
            maxExtensionDays: Math.max(0, 60 - Number(row?.termDays || 0)),
            transactionDate: toDateInputValue(row?.createdAt),
            paymentDate: toDateInputValue(new Date()),
            paymentMethod: normalizedPaymentMethod,
            paymentMethodOther: normalizedPaymentMethod === 'other' && existingPaymentMethod.toLowerCase() !== 'other'
                ? existingPaymentMethod
                : '',
            reference: '',
            note: '',
            cancelReason: '',
        });
        setIsMarkPaidModalOpen(true);
    };

    const handleCancelCreditOrder = async () => {
        if (creditMutationInFlightRef.current) return;
        if (!markPaidTarget?._id) return;

        const reason = String(markPaidForm.cancelReason || '').trim();
        if (!reason) {
            showToast('Missing Reason', 'Please provide a cancellation reason.', 'error', 'credit-cancel-validation');
            return;
        }
        if (cancelProofFiles.length < 1 || cancelProofFiles.length > 3) {
            showToast('Missing Proof', 'Choose 1 to 3 Proof of Cancellation photos.', 'error', 'credit-cancel-proof-validation');
            return;
        }

        creditMutationInFlightRef.current = true;
        setIsCancellingCredit(true);
        try {
            await cancelCreditTransactionApi(markPaidTarget._id, { reason, proofFiles: cancelProofFiles });
            showToast('Cancelled', 'Credit order cancelled and archived.', 'success', 'credit-cancel');
            setIsMarkPaidModalOpen(false);
            setIsCancelModalOpen(false);
            setMarkPaidTarget(null);
            await loadData();
        } catch (error) {
            showToast('Cancel Failed', error.message || 'Unable to cancel credit order.', 'error', 'credit-cancel');
        } finally {
            creditMutationInFlightRef.current = false;
            setIsCancellingCredit(false);
        }
    };

    const handleSubmitMarkPaid = async (e) => {
        e.preventDefault();
        if (creditMutationInFlightRef.current) return;
        if (!markPaidTarget?._id) return;

        if (paymentAmountError) {
            setFormValidationErrors(e.currentTarget, { paymentAmount: paymentAmountError });
            showToast('Invalid Amount', paymentAmountError, 'error', 'credit-payment-validation');
            return;
        }

        if (!markPaidForm.paymentDate) {
            showToast('Missing Payment Date', 'Please provide a payment date.', 'error', 'credit-mark-paid-validation');
            return;
        }

        const paymentMethod = markPaidForm.paymentMethod === 'other'
            ? normalizeHumanReadable(markPaidForm.paymentMethodOther)
            : markPaidForm.paymentMethod;
        if (!paymentMethod) {
            setFormValidationErrors(e.currentTarget, { paymentMethodOther: 'Enter the other payment method.' });
            showToast('Missing Payment Method', 'Enter the other payment method.', 'error', 'credit-payment-method-validation');
            return;
        }

        if (proofFiles.length < 1 || proofFiles.length > 3) {
            const message = 'Choose 1 to 3 Proof of Payment photos.';
            setProofError(message);
            setFormValidationErrors(e.currentTarget, { proofFiles: message });
            return;
        }

        const maxAllowedExtension = Number(markPaidForm.maxExtensionDays || 0);
        if (extensionInputError) {
            setFormValidationErrors(e.currentTarget, { extensionDays: extensionInputError });
            showToast('Invalid Extension', extensionInputError, 'error', 'credit-mark-paid-validation');
            return;
        }
        if (extensionDays > maxAllowedExtension) {
            setFormValidationErrors(e.currentTarget, { extensionDays: `Maximum extension is ${maxAllowedExtension} day(s).` });
            showToast('Extension Limit', `Maximum extension is ${maxAllowedExtension} day(s).`, 'error', 'credit-mark-paid-validation');
            return;
        }

        creditMutationInFlightRef.current = true;
        setIsSavingMarkPaid(true);
        try {
            const paidTransactionId = markPaidTarget._id;
            const paymentPayload = {
                amount: paymentAmountText,
                method: paymentMethod,
                paymentDate: markPaidForm.paymentDate,
                reference: markPaidForm.reference,
                note: markPaidForm.note,
                proofFiles,
                clientRequestId: markPaidRequestIdRef.current || (markPaidRequestIdRef.current = createClientRequestId('credit-payment')),
            };
            const updated = markPaidTarget.collectionSource === 'special_order_ledger'
                ? await markCreditTransactionPaidApi(paidTransactionId, { ...paymentPayload, extensionDays: 0 })
                : await recordCreditPaymentApi(paidTransactionId, paymentPayload);
            const updatedRemainingBalance = Number(updated?.remainingBalance);
            const fullyPaid = String(updated?.status || '').toLowerCase() === 'paid'
                || (Number.isFinite(updatedRemainingBalance) && updatedRemainingBalance <= 0);
            showToast('Updated', fullyPaid ? 'Payment recorded. Account is fully paid.' : 'Payment recorded. Remaining balance has been updated.', 'success', 'credit-payment-recorded');
            setIsMarkPaidModalOpen(false);
            setMarkPaidTarget(null);
            clearProofSelection();
            markPaidRequestIdRef.current = '';
            try {
                const finalizedRecord = await getCreditTransactionByIdApi(paidTransactionId);
                const confirmation = buildCreditConfirmation(finalizedRecord);
                setSelectedRecord(finalizedRecord);
                if (confirmation) {
                    setCreditConfirmationView(confirmation);
                } else {
                    showToast('Confirmation Unavailable', 'The saved order confirmation is not available for this transaction.', 'error', 'credit-confirmation-unavailable');
                }
            } catch (confirmationError) {
                showToast('Confirmation Load Failed', confirmationError.message || 'Payment was recorded, but the updated order confirmation could not be loaded.', 'error', 'credit-confirmation-load-error');
            }
            await loadData();
        } catch (error) {
            showToast('Payment Failed', error.message || 'Unable to record payment.', 'error', 'credit-payment-recorded');
        } finally {
            creditMutationInFlightRef.current = false;
            setIsSavingMarkPaid(false);
        }
    };

    const handleSaveExtensionOnly = async () => {
        if (creditMutationInFlightRef.current) return;
        if (!markPaidTarget?._id) return;

        if (!canSaveExtensionOnly) {
            showToast('Invalid Extension', 'Set extension day greater than 0 within allowed range.', 'error', 'credit-extension-validation');
            return;
        }

        creditMutationInFlightRef.current = true;
        setIsSavingExtensionOnly(true);
        try {
            await extendCreditTransactionTermApi(markPaidTarget._id, {
                extensionDays,
                note: markPaidForm.note,
            });
            showToast('Extended', `Day term extended by ${extensionDays} day(s).`, 'success', 'credit-extension-save');
            setIsMarkPaidModalOpen(false);
            setMarkPaidTarget(null);
            await loadData();
        } catch (error) {
            showToast('Extension Failed', error.message || 'Unable to extend day term.', 'error', 'credit-extension-save');
        } finally {
            creditMutationInFlightRef.current = false;
            setIsSavingExtensionOnly(false);
        }
    };

    return (
        <div className="flex h-auto flex-col gap-2 md:h-[calc(100vh-80px)] md:min-h-0 md:overflow-hidden">
            <div className="flex h-auto flex-col gap-3 rounded-2xl border border-slate-300 bg-slate-200/50 p-2 shadow-inner md:h-full md:min-h-0 md:p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-gray-200 pb-3">
                    <div>
                        <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Credit Transactions</p>
                        <p className="text-gray-500 font-medium text-[11px] md:text-xs">Track receivables, overdue accounts, and payment collections.</p>
                    </div>

                </div>


                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                    <div className="app-dashboard-card-hover bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Total Credit Receivables</p>
                                <p className="text-lg font-semibold text-gray-900 mt-1">{formatMoney(summary.totalCreditReceivables)}</p>
                            </div>
                            <div className="bg-gray-900 p-2 rounded-lg text-white">
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h12a2 2 0 012 2v3" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v8a2 2 0 002 2h6" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 11h14" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 16l-2-2m2 2l-2 2m2-2h-6" />
                                </svg>
                            </div>
                        </div>
                    </div>
                    <div className="app-dashboard-card-hover bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Unpaid Accounts</p>
                                <p className="text-lg font-semibold text-gray-900 mt-1">{formatNumber(summary.unpaidAccounts)}</p>
                            </div>
                            <div className="bg-gray-900 p-2 rounded-lg text-white">
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
                                    <circle cx="12" cy="12" r="9" />
                                </svg>
                            </div>
                        </div>
                    </div>
                    <div className="app-dashboard-card-hover bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Overdue Accounts</p>
                                <p className="text-lg font-semibold text-rose-700 mt-1">{formatNumber(summary.overdueAccounts)}</p>
                            </div>
                            <div className="bg-gray-900 p-2 rounded-lg text-white">
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16h.01" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86L2.82 17.2A1.5 1.5 0 004.12 19h15.76a1.5 1.5 0 001.3-1.8L13.71 3.86a1.5 1.5 0 00-2.42 0z" />
                                </svg>
                            </div>
                        </div>
                    </div>
                    <div className="app-dashboard-card-hover bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Paid Accounts</p>
                                <p className="text-lg font-semibold text-emerald-700 mt-1">{formatNumber(summary.paidAccounts)}</p>
                            </div>
                            <div className="bg-gray-900 p-2 rounded-lg text-white">
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex w-full flex-wrap items-center gap-2">
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-1">
                        {/* Search */}
                        <div className="main-toolbar-search group">
                            <input
                                type="text"
                                placeholder="Search customer, invoice, or order..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="main-toolbar-search-input"
                            />
                            <div className="main-toolbar-search-icon">
                                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                        </div>

                        {/* Filter & Sort */}
                        <div className="relative z-30 w-full flex items-center gap-2 sm:w-auto">
                        <button
                            onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                            className="px-3 py-2 rounded-xl font-semibold text-xs shadow-sm flex items-center gap-1.5 transition-all border-2 bg-gray-900 text-white border-gray-900 hover:opacity-90"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                            <span>Filter & Sort</span>
                            <svg className={`w-3 h-3 transition-transform ${isFilterPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>

                        {isFilterPanelOpen && (
                            <div className="absolute top-full mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-50 right-0 md:left-0 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[50vh] sm:max-h-[56vh] overflow-y-auto overscroll-contain">
                                {/* Date Range */}
                                <div className="px-3 pt-2 pb-1">
                                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Date Range</div>
                                </div>
                                <div className="px-2 pb-2 flex flex-wrap gap-1">
                                    {[{ key: 'all', label: 'All Time' }, { key: 'today', label: 'Today' }, { key: 'week', label: 'This Week' }, { key: 'month', label: 'This Month' }, { key: 'specific_date', label: 'Select Date' }, { key: 'custom', label: 'Custom Range' }].map((d) => (
                                        <button
                                            key={d.key}
                                            onClick={() => setDateRange(d.key)}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                                                dateRange === d.key
                                                    ? 'bg-gray-900 text-white shadow-sm'
                                                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                            }`}
                                        >
                                            {d.label}
                                        </button>
                                    ))}
                                </div>
                                {dateRange === 'specific_date' && (
                                    <div className="px-3 pb-2">
                                        <input
                                            type="date"
                                            max={new Date().toISOString().split('T')[0]}
                                            value={specificDate}
                                            onChange={(e) => setSpecificDate(e.target.value)}
                                            className="w-full px-3 py-1.5 rounded-lg text-xs font-semibold border-2 border-gray-200 focus:border-gray-900 focus:outline-none transition-all"
                                        />
                                    </div>
                                )}
                                {dateRange === 'custom' && (
                                    <div className="px-3 pb-2 flex gap-2">
                                        <input
                                            type="date"
                                            max={new Date().toISOString().split('T')[0]}
                                            value={customStartDate}
                                            onChange={(e) => setCustomStartDate(e.target.value)}
                                            className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold border-2 border-gray-200 focus:border-gray-900 focus:outline-none transition-all"
                                        />
                                        <input
                                            type="date"
                                            max={new Date().toISOString().split('T')[0]}
                                            value={customEndDate}
                                            onChange={(e) => setCustomEndDate(e.target.value)}
                                            className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold border-2 border-gray-200 focus:border-gray-900 focus:outline-none transition-all"
                                        />
                                    </div>
                                )}

                                <div className="border-t border-gray-100 mx-3"></div>

                                {/* Sort Order */}
                                <div className="px-3 pt-2 pb-1">
                                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Sort By</div>
                                </div>
                                <div className="px-2 pb-2 flex gap-1">
                                    {[{ key: 'desc', label: 'Newest First' }, { key: 'asc', label: 'Oldest First' }].map((s) => (
                                        <button
                                            key={s.key}
                                            onClick={() => setSortOrder(s.key)}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                                                sortOrder === s.key
                                                    ? 'bg-gray-900 text-white shadow-sm'
                                                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                            }`}
                                        >
                                            {s.label}
                                        </button>
                                    ))}
                                </div>

                                <div className="border-t border-gray-100 mx-3"></div>

                                {/* Status */}
                                <div className="px-3 pt-2 pb-1">
                                    <label
                                        htmlFor="credit-status-filter"
                                        className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider"
                                    >
                                        Status
                                    </label>
                                </div>
                                <div className="px-3 pb-2">
                                    <select
                                        id="credit-status-filter"
                                        value={statusFilter}
                                        onChange={(e) => setStatusFilter(e.target.value)}
                                        className="w-full rounded-lg border-2 border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:border-gray-900 focus:outline-none"
                                    >
                                        {STATUS_OPTIONS.map((status) => (
                                            <option key={status} value={status}>
                                                {status === 'All' ? 'All Status' : status}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="border-t border-gray-100 mx-3"></div>

                                {/* Customer */}
                                <div className="px-3 pt-2 pb-1">
                                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Customer</div>
                                </div>
                                <div className="px-3 pb-2">
                                    <select
                                        value={customerFilter}
                                        onChange={(e) => setCustomerFilter(e.target.value)}
                                        className="w-full rounded-lg border-2 border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:border-gray-900 focus:outline-none"
                                    >
                                        {customerOptions.map((option) => (
                                            <option key={option} value={option}>
                                                {option === 'ALL' ? 'All Customers' : option}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="border-t border-gray-100 mx-3"></div>

                                {/* Processed By */}
                                <div className="px-3 pt-2 pb-1">
                                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Processed By</div>
                                </div>
                                <div className="px-3 pb-2">
                                    <select
                                        value={processedByFilter}
                                        onChange={(e) => setProcessedByFilter(e.target.value)}
                                        className="w-full rounded-lg border-2 border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:border-gray-900 focus:outline-none"
                                    >
                                        {processedByOptions.map((option) => (
                                            <option key={option} value={option}>
                                                {option === 'ALL' ? 'All Processors' : option}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsCustomerOverdueHistoryOpen(true)}
                        className="ml-auto inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border-2 border-gray-900 bg-gray-900 px-3 py-2 text-xs font-semibold text-slate-100 shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
                    >
                        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m16 0v-2a4 4 0 0 0-3-3.87M14 3.13a4 4 0 0 1 0 7.75M10 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" /></svg>
                        <span className="whitespace-nowrap">Customer Overdue History</span>
                    </button>
                </div>

                {isFilterPanelOpen && (
                    <div className="fixed inset-0 z-20 bg-transparent" onClick={() => setIsFilterPanelOpen(false)} />
                )}

                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex flex-1 flex-col gap-3 overflow-y-auto px-0 py-2 md:hidden" aria-label="Credit transaction mobile records">
                        {isLoading ? (
                            Array.from({ length: 4 }).map((_, index) => <div key={`credit-mobile-skeleton-${index}`} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-white" />)
                        ) : visibleRows.length === 0 ? (
                            <div className="rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><ContextualEmptyState {...creditEmptyState} /></div>
                        ) : currentRows.map((row) => {
                            const displayStatus = getCreditDueStatus(row);
                            const isCancelled = displayStatus === 'Cancelled';
                            const canRecordPayment = !(isCancelled || Number(row.remainingBalance || 0) <= 0);
                            const effectiveDueDate = row.dueDate || row.originalDueDate;
                            return (
                                <article key={`mobile-${row._id}`} className={`app-dashboard-card-hover ${getAttentionRowClass(displayStatus)} rounded-xl border border-slate-200 bg-white p-3 shadow-sm`}>
                                    <div className="flex min-w-0 items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="break-all text-sm font-semibold leading-5 text-slate-900">{row.creditTransactionId}</h3>
                                            <p className="mt-0.5 break-words text-xs text-slate-600">{row.customerName}</p>
                                            {row.orderReference && <p className="mt-0.5 break-all text-[11px] text-slate-500">Order: {row.orderReference}</p>}
                                        </div>
                                        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(displayStatus)}`}>{displayStatus}</span>
                                    </div>
                                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
                                        <div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Invoice Date</dt><dd className="mt-0.5 text-xs text-slate-800">{formatDateShort(row.createdAt)}</dd></div>
                                        {effectiveDueDate && <div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Due Date</dt><dd className="mt-0.5 text-xs text-slate-800">{formatDateShort(effectiveDueDate)}</dd></div>}
                                        {row.totalAmount !== null && row.totalAmount !== undefined && Number.isFinite(Number(row.totalAmount)) && <div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Total Amount</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{formatMoney(row.totalAmount)}</dd></div>}
                                        {row.remainingBalance !== null && row.remainingBalance !== undefined && Number.isFinite(Number(row.remainingBalance)) && <div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Remaining Balance</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{formatMoney(row.remainingBalance)}</dd></div>}
                                    </dl>
                                    <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 min-[380px]:grid-cols-2">
                                        <button type="button" onClick={() => handleOpenDetails(row)} className="inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"><RecordActionIcon name="eye" />View Details</button>
                                        <button type="button" onClick={() => handleOpenMarkPaidModal(row, 'extendOnly')} disabled={isCancelled || Number(row.remainingBalance || 0) <= 0 || Number(row.termDays || 0) >= 60} className="inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50 disabled:cursor-not-allowed disabled:opacity-50"><RecordActionIcon name="calendar-clock" />Extend Day Term</button>
                                        <button type="button" onClick={() => handleOpenMarkPaidModal(row, 'markPaid')} disabled={!canRecordPayment} className={`inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-center text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50 disabled:cursor-not-allowed disabled:opacity-60 ${canRecordPayment ? 'border-slate-900 bg-slate-900 text-white hover:border-slate-700 hover:bg-slate-700' : 'border-slate-200 bg-slate-100 text-slate-400'}`}><RecordActionIcon name="wallet" />Record Payment</button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                    <div className="hidden min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain max-xl:overflow-x-auto max-xl:overscroll-x-contain md:block">
                        <table className="main-data-table w-full min-w-0 table-fixed border-separate border-spacing-0 text-left max-xl:min-w-[900px]">
                        <thead className="sticky top-0 z-10 shadow-sm">
                            <tr className="bg-gray-900 text-white uppercase tracking-wider">
                                <th className="min-w-[132px] w-[14%] whitespace-nowrap px-0.5 py-2 text-center text-[11px] font-semibold border border-gray-700 leading-none">Credit ID</th>
                                <th className="w-[13%] py-2 px-1 text-center text-[11px] font-semibold border border-gray-700 leading-none">Customer</th>
                                <th className="w-[11%] whitespace-nowrap py-2 px-1 text-center text-[11px] font-semibold border border-gray-700 leading-none">Order Ref</th>
                                <th className="w-[8%] whitespace-nowrap py-2 px-1 text-center text-[11px] font-semibold border border-gray-700 leading-none">Invoice Date</th>
                                <th className="w-[8%] whitespace-nowrap py-2 px-1 text-center text-[11px] font-semibold border border-gray-700 leading-none">Due Date</th>
                                <th className="w-[7%] py-2 px-1 text-center text-[11px] font-semibold border border-gray-700 leading-none">Extension Period</th>
                                <th className="w-[10%] whitespace-nowrap py-2 px-1 text-center text-[11px] font-semibold border border-gray-700 leading-none">Total Amount</th>
                                <th className="w-[6%] py-2 px-1 text-center text-[11px] font-semibold border border-gray-700 leading-none">Status</th>
                                <th className="w-[8%] py-2 px-1 text-center text-[11px] font-semibold border border-gray-700 leading-none">Processed By</th>
                                <th className="w-[10%] whitespace-nowrap py-2 px-1 text-center text-[11px] font-semibold border border-gray-700 leading-none">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {isLoading ? (
                                Array.from({ length: 6 }).map((_, idx) => (
                                    <tr key={`credit-skeleton-${idx}`} className="animate-pulse">
                                        <td className="py-1.5 px-2 border border-gray-200">
                                            <div className="mx-auto h-5 w-24 rounded-md bg-gray-200" />
                                        </td>
                                        <td className="py-1.5 px-2 border border-gray-200">
                                            <div className="mx-auto h-4 w-28 rounded-md bg-gray-200" />
                                        </td>
                                        <td className="py-1.5 px-2 border border-gray-200">
                                            <div className="mx-auto h-4 w-20 rounded-md bg-gray-200" />
                                        </td>
                                        <td className="py-1.5 px-2 border border-gray-200">
                                            <div className="mx-auto h-4 w-20 rounded-md bg-gray-200" />
                                        </td>
                                        <td className="py-1.5 px-2 border border-gray-200">
                                            <div className="mx-auto h-4 w-20 rounded-md bg-gray-200" />
                                        </td>
                                        <td className="py-1.5 px-2 border border-gray-200">
                                            <div className="mx-auto h-4 w-20 rounded-md bg-gray-200" />
                                        </td>
                                        <td className="py-1.5 px-2 border border-gray-200">
                                            <div className="mx-auto h-4 w-24 rounded-md bg-gray-200" />
                                        </td>
                                        <td className="py-1.5 px-2 border border-gray-200">
                                            <div className="mx-auto h-5 w-16 rounded-full bg-gray-200" />
                                        </td>
                                        <td className="py-1.5 px-2 border border-gray-200">
                                            <div className="mx-auto h-4 w-24 rounded-md bg-gray-200" />
                                        </td>
                                        <td className="py-1.5 px-2 border border-gray-200">
                                            <div className="mx-auto flex items-center justify-center gap-1">
                                                <div className="h-6 w-6 rounded-md bg-gray-200" />
                                                <div className="h-6 w-6 rounded-md bg-gray-200" />
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : visibleRows.length === 0 ? (
                                <tr>
                                    <td className="border border-gray-200 px-2 py-2 text-center" colSpan={10}><ContextualEmptyState {...creditEmptyState} /></td>
                                </tr>
                            ) : (
                                currentRows.map((row) => (
                                    (() => {
                                        const originalDueDate = row.originalDueDate || row.dueDate;
                                        const hasExtendedDueDate = Boolean(row.originalDueDate);
                                        const newDueDate = hasExtendedDueDate ? row.dueDate : null;
                                        const displayStatus = getCreditDueStatus(row);
                                        const isCancelled = displayStatus === 'Cancelled';
                                        return (
                                    <tr key={row._id} className={`app-dashboard-table-row-hover ${getAttentionRowClass(displayStatus)} group`}>
                                        <td className="whitespace-nowrap px-0.5 py-1.5 text-center border border-gray-200 leading-tight">
                                            <IdentifierChip className="whitespace-nowrap break-normal px-1.5 text-[11px]">{row.creditTransactionId}</IdentifierChip>
                                        </td>
                                        <td className="py-1.5 px-1 font-semibold text-gray-900 text-xs text-center border border-gray-200 leading-tight">{row.customerName}</td>
                                        <td className="whitespace-nowrap py-1.5 px-1 text-center border border-gray-200 leading-tight">{row.orderReference ? <IdentifierChip className="whitespace-nowrap">{row.orderReference}</IdentifierChip> : '-'}</td>
                                        <td className="whitespace-nowrap py-1.5 px-1 text-gray-800 font-medium text-xs text-center border border-gray-200 leading-tight">{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '-'}</td>
                                        <td className="whitespace-nowrap py-1.5 px-1 text-gray-800 font-medium text-xs text-center border border-gray-200 leading-tight">{originalDueDate ? new Date(originalDueDate).toLocaleDateString() : '-'}</td>
                                        <td className="whitespace-nowrap py-1.5 px-1 text-gray-800 font-medium text-xs text-center border border-gray-200 leading-tight">{newDueDate ? new Date(newDueDate).toLocaleDateString() : '-'}</td>
                                        <td className="whitespace-nowrap py-1.5 px-1 font-semibold text-black text-sm text-center border border-gray-200 tabular-nums leading-tight">{formatMoney(row.totalAmount)}</td>
                                        <td className="py-1.5 px-1 text-center border border-gray-200 leading-tight">
                                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${statusBadgeClass(displayStatus)}`}>
                                                {displayStatus}
                                            </span>
                                        </td>
                                        <td className="py-1.5 px-1 text-center border border-gray-200 leading-tight">
                                            <span className="text-gray-900 font-semibold text-xs">{getCreditProcessorDisplayName(row)}</span>
                                        </td>
                                        <td className="whitespace-nowrap py-1.5 px-1 text-center border border-gray-200">
                                            <div className="flex flex-nowrap items-center justify-center gap-2">
                                                <TableActionButton
                                                    onClick={() => handleOpenDetails(row)}
                                                    label="View Details"
                                                    className={displayStatus === 'Paid' ? 'credit-record-payment-action' : ''}
                                                >
                                                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M1.5 12s3.6-7 10.5-7 10.5 7 10.5 7-3.6 7-10.5 7S1.5 12 1.5 12z" />
                                                        <circle cx="12" cy="12" r="3" />
                                                    </svg>
                                                </TableActionButton>
                                                <TableActionButton
                                                    onClick={() => handleOpenMarkPaidModal(row, 'extendOnly')}
                                                    disabled={isCancelled || Number(row.remainingBalance || 0) <= 0 || Number(row.termDays || 0) >= 60}
                                                    label="Extend Day Term"
                                                >
                                                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3" />
                                                        <circle cx="12" cy="12" r="9" />
                                                    </svg>
                                                </TableActionButton>
                                                <TableActionButton
                                                    onClick={() => handleOpenMarkPaidModal(row, 'markPaid')}
                                                    disabled={isCancelled || Number(row.remainingBalance || 0) <= 0}
                                                    className="credit-record-payment-action"
                                                    label="Record Payment"
                                                >
                                                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" />
                                                    </svg>
                                                </TableActionButton>
                                            </div>
                                        </td>
                                    </tr>
                                        );
                                    })()
                                ))
                            )}
                        </tbody>
                        </table>
                    </div>

                    <div className="w-full shrink-0 border-t border-gray-200 bg-slate-200/95 px-4 py-2 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur-sm md:px-6 md:py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-gray-500 font-medium">
                                Showing <span className="font-semibold text-gray-900">{displayStart}</span> to <span className="font-semibold text-gray-900">{displayEnd}</span> of <span className="font-semibold text-gray-900">{visibleRows.length}</span> results
                            </div>
                            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={itemsPerPage} onPageSizeChange={(pageSize) => { setItemsPerPage(pageSize); setCurrentPage(1); }} />
                        </div>
                    </div>
                </div>
            </div>

            {isDetailsOpen && selectedRecord && !proofLightbox && !creditConfirmationView && (
                <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4">
                    <section role="dialog" aria-modal="true" aria-labelledby="credit-transaction-details-title" onClick={(event) => event.stopPropagation()} className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
                        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-5">
                            <div className="min-w-0">
                                <h2 id="credit-transaction-details-title" className="text-lg font-semibold tracking-tight text-slate-950">Credit Transaction Details</h2>
                                <p className="mt-0.5 break-all text-xs text-slate-500">Credit ID: <span className="font-medium text-slate-700">{selectedRecord.creditTransactionId || '—'}</span></p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <div className="text-right">
                                    <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">Payment Status</span>
                                    <span className={`mt-0.5 inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(selectedPaymentStatus)}`}>{selectedPaymentStatus}</span>
                                </div>
                                <button type="button" onClick={() => setIsDetailsOpen(false)} aria-label="Close credit transaction details" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2">
                                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </header>

                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:space-y-4 sm:px-5 sm:py-4">
                            <section aria-label="Transaction information" className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
                                <h3 className="mb-3 text-sm font-semibold text-slate-900">Transaction Information</h3>
                                <dl className="grid grid-cols-1 gap-x-5 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                                    <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Customer</dt><dd className="mt-1 break-words font-medium text-slate-900">{selectedRecord.customerName || '—'}</dd></div>
                                    <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Order Reference</dt><dd className="mt-1 break-all font-medium text-slate-900">{selectedRecord.orderReference || '—'}</dd></div>
                                    <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Order Date</dt><dd className="mt-1 font-medium text-slate-900">{formatDateShort(getOrderDate(selectedRecord))}</dd></div>
                                    <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Due Date</dt><dd className="mt-1 font-medium text-slate-900">{formatDateShort(selectedRecord.dueDate)}</dd></div>
                                    {getDatePaid(selectedRecord) && <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Date Paid</dt><dd className="mt-1 font-medium text-slate-900">{formatDateShort(getDatePaid(selectedRecord))}</dd></div>}
                                    <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Processed By</dt><dd className="mt-1 break-words font-medium text-slate-900">{getCreditProcessorDisplayName(selectedRecord)}</dd></div>
                                    {selectedRecord.originalDueDate && <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Recorded Original Due Date</dt><dd className="mt-1 font-medium text-slate-900">{formatDateShort(selectedRecord.originalDueDate)}</dd></div>}
                                    {Number(selectedRecord.termDays) > 0 && <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Credit Term</dt><dd className="mt-1 font-medium text-slate-900">{formatNumber(selectedRecord.termDays)} days</dd></div>}
                                </dl>
                            </section>

                            <section aria-label="Payment summary" className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
                                <h3 className="text-sm font-semibold text-slate-900">Payment Summary</h3>
                                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                                    <div className="min-w-0"><dt className="text-xs text-slate-500">Total Amount</dt><dd className="mt-1 font-semibold tabular-nums text-slate-900">{formatMoney(selectedRecord.totalAmount)}</dd></div>
                                    <div className="min-w-0"><dt className="text-xs text-slate-500">Down Payment</dt><dd className="mt-1 font-semibold tabular-nums text-slate-900">{getDownPayment(selectedRecord) ? formatMoney(getDownPayment(selectedRecord).amount) : '—'}</dd><dd className="mt-0.5 text-[10px] text-slate-500">Included in Total Paid</dd></div>
                                    <div className="min-w-0"><dt className="text-xs text-slate-500">Total Paid</dt><dd className="mt-1 font-semibold tabular-nums text-slate-900">{formatMoney(selectedRecord.amountPaid)}</dd></div>
                                    <div className="min-w-0"><dt className="text-xs text-slate-500">Remaining Balance</dt><dd className={`mt-1 font-semibold tabular-nums ${Number(selectedRecord.remainingBalance || 0) > 0 ? 'text-amber-800' : 'text-slate-900'}`}>{formatMoney(selectedRecord.remainingBalance)}</dd></div>
                                </dl>
                            </section>

                            <section aria-label="Order items" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                <div className="border-b border-slate-200 px-3.5 py-2.5 sm:px-4"><h3 className="text-sm font-semibold text-slate-900">Order Items</h3></div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[620px] table-fixed border-collapse text-sm">
                                        <colgroup><col className="w-[52%]" /><col className="w-[14%]" /><col className="w-[17%]" /><col className="w-[17%]" /></colgroup>
                                        <thead className="bg-slate-900 text-white"><tr><th scope="col" className="px-3 py-2.5 text-left text-xs font-semibold sm:px-4">Item</th><th scope="col" className="whitespace-nowrap px-2 py-2.5 text-right text-xs font-semibold">Quantity</th><th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold">Unit Price</th><th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold sm:px-4">Subtotal</th></tr></thead>
                                        <tbody className="divide-y divide-slate-200 text-slate-700">
                                            {(selectedRecord.orderId?.items || []).length === 0 ? <tr><td className="px-4 py-7 text-center text-sm text-slate-500" colSpan={4}>No order items available.</td></tr> : (selectedRecord.orderId?.items || []).map((item, idx) => (
                                                <tr key={`${item.code || item.name || 'item'}-${idx}`}>
                                                    <td className="px-3 py-3 align-top sm:px-4"><p className="break-words font-semibold leading-5 text-slate-950">{getTransactionProductDisplayName(item, processedInventory, productCategories)}</p><p className="mt-0.5 break-all text-xs text-slate-500">{item.code || '—'}</p></td>
                                                    <td className="whitespace-nowrap px-2 py-3 text-right align-top tabular-nums">{formatNumber(item.quantity)}</td>
                                                    <td className="whitespace-nowrap px-3 py-3 text-right align-top tabular-nums">{formatMoney(item.unitPrice)}</td>
                                                    <td className="whitespace-nowrap px-3 py-3 text-right align-top font-medium tabular-nums sm:px-4">{formatMoney(item.subtotal)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>

                            <section aria-label="Payment history" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                <div className="border-b border-slate-200 px-3.5 py-2.5 sm:px-4"><h3 className="text-sm font-semibold text-slate-900">Payment History</h3></div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[680px] border-collapse text-xs">
                                        <thead className="bg-slate-900 text-white"><tr><th scope="col" className="px-3 py-2.5 text-left text-xs font-semibold sm:px-4">Date</th><th scope="col" className="px-2 py-2.5 text-left text-xs font-semibold">Type</th><th scope="col" className="px-3 py-2.5 text-right text-xs font-semibold">Amount</th><th scope="col" className="px-3 py-2.5 text-left text-xs font-semibold">Method</th><th scope="col" className="px-3 py-2.5 text-left text-xs font-semibold">Reference</th><th scope="col" className="px-3 py-2.5 text-left text-xs font-semibold sm:px-4">Evidence</th></tr></thead>
                                        <tbody className="divide-y divide-slate-200 text-slate-700">
                                            {(selectedRecord.paymentHistory || []).length === 0 ? <tr><td colSpan={6} className="px-3 py-7 text-center text-sm text-slate-500">No payments recorded yet.</td></tr> : (selectedRecord.paymentHistory || []).map((payment, index) => (
                                                <tr key={`${payment.clientRequestId || payment.paymentDate || 'payment'}-${index}`}>
                                                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-4">{formatDateShort(payment.paymentDate)}</td>
                                                    <td className="whitespace-nowrap px-2 py-2.5">{getPaymentEventLabel(selectedRecord, payment, index)}</td>
                                                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{formatMoney(payment.amount)}</td>
                                                    <td className="px-3 py-2.5 capitalize">{payment.method || '—'}</td>
                                                    <td className="max-w-36 truncate px-3 py-2.5" title={payment.reference || ''}>{payment.reference || '—'}</td>
                                                    <td className="px-3 py-2.5 sm:px-4">{payment.clientRequestId && (payment.proofs?.length || payment.proof?.storageKey) ? <div className="flex flex-wrap gap-1">{(payment.proofs?.length ? payment.proofs : [payment.proof]).map((proof, proofIndex) => <button key={`${proof.storageKey}-${proofIndex}`} type="button" onClick={() => handleViewPaymentProof(payment, proofIndex)} className="rounded px-1 font-semibold text-slate-800 underline underline-offset-2 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600">View {proofIndex + 1}</button>)}</div> : '—'}</td>
                                                </tr>
                                            ))}
                                            {selectedRecord.proofOfPayment && !selectedLegacyProofIsInHistory && <tr><td className="whitespace-nowrap px-3 py-2.5 sm:px-4">{getDatePaid(selectedRecord) ? formatDateShort(getDatePaid(selectedRecord)) : '—'}</td><td className="px-2 py-2.5">Payment Evidence</td><td className="px-3 py-2.5 text-right text-slate-500">—</td><td className="px-3 py-2.5 capitalize">{getCreditPaymentMode(selectedRecord)}</td><td className="px-3 py-2.5 text-slate-500">—</td><td className="px-3 py-2.5 sm:px-4"><button type="button" onClick={handleViewProof} className="rounded px-1 font-semibold text-slate-800 underline underline-offset-2 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600">View Proof</button></td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </section>

                            {String(selectedRecord.status || '').toLowerCase() === 'cancelled' && <section aria-label="Cancellation details" className="rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 sm:p-4">
                                <h3 className="font-semibold text-slate-900">Cancellation</h3>
                                <p className="mt-1.5">Reason: {selectedRecord.cancelReason || '—'}</p>
                                <p className="mt-1.5 text-xs text-slate-600">Previously recorded payments remain in Payment History; cancellation does not refund them.</p>
                                {(selectedRecord.cancelProofs || []).length > 0 && <div className="mt-3 flex flex-wrap gap-2">{selectedRecord.cancelProofs.map((proof, index) => <button key={`${proof.storageKey}-${index}`} type="button" onClick={() => handleViewCancellationProof(index)} className="font-semibold text-slate-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600">View Cancellation Proof {index + 1}</button>)}</div>}
                            </section>}
                        </div>

                        {selectedCreditConfirmation && <footer className="flex shrink-0 justify-end border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
                            <button type="button" onClick={handleViewConfirmation} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2">View Confirmation</button>
                        </footer>}
                    </section>
                </div>
            )}

            {creditConfirmationView && (
                <OrderConfirmationModal
                    transaction={creditConfirmationView.transaction}
                    customer={creditConfirmationView.customer}
                    settings={appSettings}
                    readOnly
                    onBack={() => setCreditConfirmationView(null)}
                    onContinue={() => setCreditConfirmationView(null)}
                />
            )}

            {proofLightbox && (
                <div className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Proof of Payment preview">
                    <div className="relative max-h-full max-w-4xl" onClick={(event) => event.stopPropagation()}>
                        <img src={proofLightbox.url} alt={proofLightbox.fileName} className="max-h-[85vh] max-w-full rounded-lg bg-white object-contain shadow-2xl" />
                        <button
                            type="button"
                            onClick={closeProofLightbox}
                            className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-gray-700 shadow hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-white"
                            aria-label="Close proof preview"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {isCustomerOverdueHistoryOpen && (
                <CustomerOverdueHistoryModal onClose={() => setIsCustomerOverdueHistoryOpen(false)} />
            )}

            {isMarkPaidModalOpen && markPaidTarget && !isCancelModalOpen && (
                <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div onClick={(event) => event.stopPropagation()} className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-5 py-3.5 border-b border-gray-100 bg-linear-to-r from-gray-50 to-white flex items-center justify-between rounded-t-2xl">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
                                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                </div>
                                <div>
                                    <h3 className="font-semibold text-sm text-gray-900 leading-tight">{markPaidModalMode === 'extendOnly' ? 'Extend Day Term' : 'Record Payment'}</h3>
                                    <p className="text-gray-400 text-[10px] mt-0.5">{markPaidModalMode === 'extendOnly' ? 'Update the due date without recording payment.' : 'Record a confirmed partial or final payment.'}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsMarkPaidModalOpen(false)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        <form onSubmit={markPaidModalMode === 'markPaid' ? handleSubmitMarkPaid : (e) => e.preventDefault()} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 py-3">
                            <div className={markPaidModalMode === 'markPaid' ? 'grid grid-cols-1 gap-2 sm:grid-cols-2' : 'space-y-2.5'}>
                                <div>
                                    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Transaction ID</label>
                                    <input
                                        type="text"
                                        value={markPaidForm.transactionId}
                                        readOnly
                                        className="mt-1 w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono font-semibold text-gray-500"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Customer Name</label>
                                    <input
                                        type="text"
                                        value={markPaidForm.customerName}
                                        readOnly
                                        className="mt-1 w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-800"
                                    />
                                </div>
                            </div>
                            {markPaidModalMode === 'markPaid' ? (
                                <>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        <div>
                                            <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Payment Amount (₱)</label>
                                            <input
                                                type="text"
                                                name="paymentAmount"
                                                data-validation-key="paymentAmount"
                                                inputMode="decimal"
                                                value={markPaidForm.amount}
                                                onChange={(e) => setMarkPaidForm((prev) => ({ ...prev, amount: e.target.value }))}
                                                readOnly={markPaidTarget?.collectionSource === 'special_order_ledger'}
                                                aria-invalid={Boolean(paymentAmountError)}
                                                aria-describedby={paymentAmountError ? 'credit-payment-amount-error' : 'credit-payment-balance-after'}
                                                className={`mt-1 w-full p-2 bg-white border rounded-lg text-xs font-semibold text-gray-900 outline-none ${paymentAmountError ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-100' : 'border-gray-300 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'}`}
                                            />
                                            {paymentAmountError && <p id="credit-payment-amount-error" role="alert" className="mt-1 text-[10px] font-medium text-rose-600">{paymentAmountError}</p>}
                                        </div>
                                        <div>
                                            <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Payment Date</label>
                                            <input
                                                type="date"
                                                value={markPaidForm.paymentDate}
                                                readOnly
                                                className="mt-1 w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700"
                                            />
                                        </div>
                                    </div>
                                    <div id="credit-payment-balance-after" className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
                                        <div><p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Invoice Total</p><p className="mt-0.5 font-semibold text-gray-900">{formatMoney(markPaidTarget.totalAmount)}</p></div>
                                        <div><p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Total Paid</p><p className="mt-0.5 font-semibold text-gray-900">{formatMoney(markPaidTarget.amountPaid)}</p></div>
                                        <div><p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Remaining Balance</p><p className="mt-0.5 font-semibold text-gray-900">{formatMoney(markPaidTarget.remainingBalance)}</p></div>
                                        <div><p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Balance After Payment</p><p className="mt-0.5 font-semibold text-gray-900">{balanceAfterPayment === null ? '—' : formatMoney(balanceAfterPayment)}</p></div>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        <div>
                                            <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Transaction Date</label>
                                            <input
                                                type="date"
                                                value={markPaidForm.transactionDate}
                                                readOnly
                                                className="mt-1 w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700"
                                            />
                                        </div>
                                        <div className="relative" ref={markPaidPaymentMethodRef}>
                                            <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Payment Method</label>
                                            <button
                                                type="button"
                                                data-validation-key="paymentMethod"
                                                onClick={() => setIsMarkPaidPaymentMethodOpen((prev) => !prev)}
                                                aria-haspopup="listbox"
                                                aria-expanded={isMarkPaidPaymentMethodOpen}
                                                className="mt-1 flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-2 py-2 text-left text-xs font-semibold text-gray-800 transition-colors hover:border-amber-400 focus:border-amber-500 focus:outline-none"
                                            >
                                                <span>{formatPaymentModeLabel(markPaidForm.paymentMethod)}</span>
                                                <svg className={`h-4 w-4 text-gray-400 transition-transform ${isMarkPaidPaymentMethodOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 9 6 6 6-6" /></svg>
                                            </button>
                                            {isMarkPaidPaymentMethodOpen && (
                                                <div className="absolute z-20 top-full mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg" role="listbox">
                                                    <div className="max-h-40 overflow-y-auto py-1">
                                                        {CREDIT_PAYMENT_MODES.map((mode) => (
                                                            <button
                                                                key={mode}
                                                                type="button"
                                                                role="option"
                                                                aria-selected={markPaidForm.paymentMethod === mode}
                                                                onClick={() => {
                                                                    setMarkPaidForm((prev) => ({
                                                                        ...prev,
                                                                        paymentMethod: mode,
                                                                        paymentMethodOther: mode === 'other' ? prev.paymentMethodOther : '',
                                                                    }));
                                                                    setIsMarkPaidPaymentMethodOpen(false);
                                                                    if (mode === 'other') focusCustomMarkPaidPaymentMethodInput();
                                                                }}
                                                                className={`w-full px-3 py-2 text-left text-xs font-semibold transition-colors hover:bg-amber-50 focus:bg-amber-50 focus:outline-none ${markPaidForm.paymentMethod === mode ? 'bg-amber-50 text-amber-700' : 'text-gray-700'}`}
                                                            >
                                                                {formatPaymentModeLabel(mode)}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {markPaidForm.paymentMethod === 'other' && (
                                                <input
                                                    ref={customMarkPaidPaymentMethodInputRef}
                                                    type="text"
                                                    name="paymentMethodOther"
                                                    data-validation-key="paymentMethodOther"
                                                    value={markPaidForm.paymentMethodOther || ''}
                                                    onChange={(e) => setMarkPaidForm((prev) => ({ ...prev, paymentMethodOther: e.target.value }))}
                                                    onBlur={(e) => setMarkPaidForm((prev) => ({ ...prev, paymentMethodOther: normalizeHumanReadable(e.target.value) }))}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') e.preventDefault();
                                                        if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            markPaidPaymentMethodRef.current?.querySelector('button')?.focus();
                                                        }
                                                    }}
                                                    placeholder="Type other payment method"
                                                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs font-semibold text-gray-800 focus:border-amber-500 focus:outline-none"
                                                />
                                            )}
                                        </div>
                                    </div>
                                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                                        Payment Reference (Optional)
                                        <input
                                            type="text"
                                            value={markPaidForm.reference || ''}
                                            onChange={(e) => setMarkPaidForm((prev) => ({ ...prev, reference: e.target.value }))}
                                            placeholder="Reference or confirmation number"
                                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs font-semibold text-gray-800 outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                                        />
                                    </label>
                                </>
                            ) : (
                                <div className="grid grid-cols-2 gap-2.5">
                                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Current Due Date</p>
                                        <p className="mt-1 text-xs font-semibold text-gray-900">{formatDateShort(markPaidTarget?.dueDate)}</p>
                                    </div>
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Extension Period</p>
                                        <p className="mt-1 text-xs font-semibold text-amber-800">{formatDateShort(previewDueDate)}</p>
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <div>
                                    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Term Days</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={markPaidForm.termDays}
                                        readOnly
                                        className="mt-1 w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Extension (Days)</label>
                                    {markPaidModalMode === 'extendOnly' ? (
                                        <div className="mt-1 flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const current = Number(markPaidForm.extensionDays || 0);
                                                    const next = Math.max(0, current - 1);
                                                    setMarkPaidForm((prev) => ({ ...prev, extensionDays: String(next) }));
                                                }}
                                                disabled={isExtensionUnavailable}
                                                className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label="Decrease extension days"
                                            >
                                                -
                                            </button>
                                            <input
                                                type="text"
                                                name="extensionDays"
                                                data-validation-key="extensionDays"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                min="0"
                                                step="1"
                                                placeholder="0"
                                                value={markPaidForm.extensionDays}
                                                onKeyDown={preventInvalidWholeNumberKeyDown}
                                                onPaste={preventInvalidWholeNumberPaste}
                                                onChange={(e) => setMarkPaidForm((prev) => ({ ...prev, extensionDays: clampExtensionDays(e.target.value) }))}
                                                disabled={isExtensionUnavailable}
                                                className={`h-8 w-full rounded-lg border bg-white px-2 text-center text-xs font-medium outline-none text-gray-900 ${((hasExtensionInput && extensionInputError) || isExtensionOutOfRange) ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-200' : 'border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'}`}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const current = Number(markPaidForm.extensionDays || 0);
                                                    const next = Math.min(extensionMax, Math.max(0, current + 1));
                                                    setMarkPaidForm((prev) => ({ ...prev, extensionDays: String(next) }));
                                                }}
                                                disabled={isExtensionUnavailable}
                                                className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label="Increase extension days"
                                            >
                                                +
                                            </button>
                                        </div>
                                    ) : (
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={markPaidForm.extensionDays || '0'}
                                            readOnly
                                            className="mt-1 h-8 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 text-center text-xs font-semibold text-gray-700"
                                        />
                                    )}
                                    {extensionHelperMessage && (
                                        <p className={`mt-1 text-[10px] ${extensionHelperClass}`}>
                                            {extensionHelperMessage}
                                        </p>
                                    )}
                                </div>
                            </div>
                            {markPaidModalMode === 'markPaid' && (
                                <EvidenceUploadField id="credit-payment-proof" validationKey="proofFiles" label="Proof of Payment" files={proofFiles} onChange={(files) => { setProofFiles(files); setProofError(''); }} minFiles={1} maxFiles={3} disabled={isSavingMarkPaid} error={proofError} />
                            )}
                            <div>
                                <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Notes (Optional)</label>
                                <textarea
                                    rows={2}
                                    value={markPaidForm.note}
                                    onChange={(e) => setMarkPaidForm((prev) => ({ ...prev, note: e.target.value }))}
                                    className="mt-1 min-h-16 w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 outline-none text-gray-900 resize-none"
                                    placeholder="Add note (optional)"
                                />
                            </div>

                            <div className="flex gap-2.5 pt-1">
                                {markPaidModalMode === 'markPaid' && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsCancelModalOpen(true);
                                            setIsCancelConfirmOpen(false);
                                        }}
                                        disabled={isSavingMarkPaid || isSavingExtensionOnly || isCancellingCredit}
                                        className={`flex-1 py-2.5 rounded-xl text-xs font-semibold shadow-md transition-all transform ${(isSavingMarkPaid || isSavingExtensionOnly || isCancellingCredit) ? 'bg-rose-200 text-rose-700 cursor-not-allowed' : 'bg-rose-500 text-white hover:bg-rose-600 hover:-translate-y-0.5'}`}
                                    >
                                        {isCancellingCredit ? 'Cancelling...' : 'Cancel Order'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setIsMarkPaidModalOpen(false)}
                                    disabled={isSavingMarkPaid || isSavingExtensionOnly || isCancellingCredit}
                                    className={`flex-1 py-2.5 rounded-xl font-semibold text-xs transition-colors ${(isSavingMarkPaid || isSavingExtensionOnly || isCancellingCredit) ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                >
                                    Cancel
                                </button>
                                {markPaidModalMode === 'extendOnly' && (
                                    <button
                                        type="button"
                                        onClick={handleSaveExtensionOnly}
                                        disabled={isSavingMarkPaid || isSavingExtensionOnly || isCancellingCredit || !canSaveExtensionOnly || Boolean(extensionInputError)}
                                        className={`flex-1 py-2.5 rounded-xl text-xs font-semibold shadow-md transition-all transform ${(isSavingMarkPaid || isSavingExtensionOnly || !canSaveExtensionOnly || extensionInputError) ? 'bg-amber-200 text-amber-800 cursor-not-allowed' : 'bg-amber-300 text-amber-900 hover:bg-amber-400 hover:-translate-y-0.5'}`}
                                    >
                                        {isSavingExtensionOnly ? 'Saving Extension...' : 'Save Extension'}
                                    </button>
                                )}
                                {markPaidModalMode === 'markPaid' && (
                                    <button
                                        type="submit"
                                        disabled={isSavingMarkPaid || isSavingExtensionOnly || isCancellingCredit || Boolean(paymentAmountError) || proofFiles.length < 1}
                                        className={`flex-1 py-2.5 rounded-xl text-xs font-semibold text-white shadow-md transition-all transform ${(isSavingMarkPaid || isSavingExtensionOnly || paymentAmountError || proofFiles.length < 1) ? 'bg-gray-500 cursor-not-allowed' : 'bg-gray-900 hover:opacity-90 hover:-translate-y-0.5'}`}
                                    >
                                        {isSavingMarkPaid ? 'Saving...' : 'Record Payment'}
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isCancelModalOpen && markPaidTarget && (
                <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div onClick={(event) => event.stopPropagation()} className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-200 dark:border-slate-700 dark:bg-slate-900">
                        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cancel Credit Order</h3>
                            <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Provide a reason and 1–3 proof photos. Cancellation does not refund recorded payments.</p>
                        </div>

                        <div className="px-5 py-4">
                            {isCancelConfirmOpen ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 text-left dark:border-rose-900/70 dark:bg-rose-950/25">
                                    <div className="flex items-start gap-2.5">
                                        <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3.75m0 3.75h.008v.008H12V16.5Zm8.25-4.5a8.25 8.25 0 1 1-16.5 0 8.25 8.25 0 0 1 16.5 0Z" /></svg>
                                        <div>
                                            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Confirm cancellation</p>
                                            <p className="mt-1 text-[11px] leading-4 text-slate-600 dark:text-slate-400">
                                                Cancel <span className="font-semibold text-slate-800 dark:text-slate-200">Transaction {markPaidForm.transactionId || '-'}</span>? This action will update its status.
                                            </p>
                                            <p className="mt-1 text-[11px] text-rose-700">Previously collected payments are not refunded or reversed. {cancelProofFiles.length} proof photo(s) attached.</p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <label htmlFor="credit-cancel-reason" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cancel Reason</label>
                                    <textarea
                                        id="credit-cancel-reason"
                                        rows={3}
                                        value={markPaidForm.cancelReason}
                                        onChange={(e) => setMarkPaidForm((prev) => ({ ...prev, cancelReason: e.target.value }))}
                                        className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-rose-700 dark:focus:ring-rose-950/60"
                                        placeholder="Add cancellation reason"
                                    />
                                    <p className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">Required to cancel this credit order.</p>
                                </div>
                            )}

                            {!isCancelConfirmOpen && <div className="mt-3"><EvidenceUploadField id="credit-cancel-proof" label="Proof of Cancellation" files={cancelProofFiles} onChange={setCancelProofFiles} minFiles={1} maxFiles={3} disabled={isCancellingCredit} /></div>}

                            <div className="mt-4 flex gap-2.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsCancelModalOpen(false);
                                        setIsCancelConfirmOpen(false);
                                    }}
                                    disabled={isCancellingCredit}
                                    className={`flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 ${isCancellingCredit ? 'cursor-not-allowed opacity-60' : ''}`}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!isCancelConfirmOpen) {
                                            setIsCancelConfirmOpen(true);
                                            return;
                                        }
                                        handleCancelCreditOrder();
                                    }}
                                    disabled={isCancellingCredit || !String(markPaidForm.cancelReason || '').trim() || cancelProofFiles.length < 1}
                                    className={`flex-1 rounded-xl border py-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 ${(isCancellingCredit || !String(markPaidForm.cancelReason || '').trim() || cancelProofFiles.length < 1) ? 'cursor-not-allowed border-rose-200 bg-rose-100 text-rose-400 dark:border-rose-950 dark:bg-rose-950/35 dark:text-rose-700' : 'border-rose-700 bg-rose-700 text-white hover:border-rose-800 hover:bg-rose-800 dark:border-rose-800 dark:bg-rose-900/70 dark:text-rose-100 dark:hover:bg-rose-900'}`}
                                >
                                    {isCancellingCredit ? 'Cancelling...' : (isCancelConfirmOpen ? 'Confirm' : 'Cancel Order')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreditTransactions;
