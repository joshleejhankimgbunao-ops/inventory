import React, { useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '../utils/toastHelper';
import { showPageLoadError } from '../utils/pageLoadError';
import { useAuth } from '../context/AuthContext';
import {
    getCreditTransactionByIdApi,
    getCreditTransactionsSummaryApi,
    listCreditTransactionsApi,
    markCreditTransactionPaidApi,
    getCreditTransactionProofApi,
    extendCreditTransactionTermApi,
    cancelCreditTransactionApi,
} from '../services/inventoryApi';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import Pagination from '../components/Pagination';
import IdentifierChip from '../components/IdentifierChip';
import ReceiptPreviewModal from '../components/ReceiptPreviewModal';
import TableActionButton from '../components/TableActionButton';
import { formatCurrency, formatNumber } from '../utils/numberFormat';
import { getCreditDueStatus } from '../utils/creditDueStatus';
import { getActorDisplayName } from '../utils/actorDisplay';
import { getAttentionRowClass } from '../utils/tableStatusStyle';
import { normalizeHumanReadable } from '../utils/textNormalization';
import { createClientRequestId } from '../utils/clientRequestId';
import { buildCreditReceiptTransaction, isFullyPaidCreditTransaction } from '../utils/creditReceipt';
import { printReceipt } from '../services/receiptPrinter';
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

    const modeMatch = String(record?.orderId?.notes || '').trim().match(/preferred mode of payment:\s*(.+)$/i);
    return modeMatch ? String(modeMatch[1] || '').trim() : record?.orderId?.paymentMethod || '-';
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
const MAX_PROOF_OF_PAYMENT_SIZE = 5 * 1024 * 1024;
const ACCEPTED_PROOF_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

const CreditTransactions = () => {
    const { appSettings, userRole, currentUserName, ROLES } = useAuth();
    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState({
        totalCreditReceivables: 0,
        unpaidAccounts: 0,
        partiallyPaidAccounts: 0,
        paidAccounts: 0,
        overdueAccounts: 0,
    });
    const [searchQuery, setSearchQuery] = useState('');
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
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const [selectedRecord, setSelectedRecord] = useState(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [creditReceiptPreview, setCreditReceiptPreview] = useState(null);
    const [creditReceiptPrintStatus, setCreditReceiptPrintStatus] = useState('idle');
    const creditReceiptPrintInFlightRef = useRef(false);

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
        note: '',
        cancelReason: '',
    });
    const [isSavingMarkPaid, setIsSavingMarkPaid] = useState(false);
    const [isMarkPaidPaymentMethodOpen, setIsMarkPaidPaymentMethodOpen] = useState(false);
    const [isSavingExtensionOnly, setIsSavingExtensionOnly] = useState(false);
    const creditMutationInFlightRef = useRef(false);
    const markPaidRequestIdRef = useRef('');
    const [isCancellingCredit, setIsCancellingCredit] = useState(false);
    const [proofFile, setProofFile] = useState(null);
    const [proofPreviewUrl, setProofPreviewUrl] = useState('');
    const [proofError, setProofError] = useState('');
    const [proofLightbox, setProofLightbox] = useState(null);
    const proofInputRef = useRef(null);
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
    const selectedDisplayStatus = selectedRecord ? getCreditDueStatus(selectedRecord) : '';

    useEffect(() => () => {
        if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    }, [proofPreviewUrl]);

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
        setIsLoading(true);
        try {
            const [nextSummary, nextRows] = await Promise.all([
                getCreditTransactionsSummaryApi(),
                listCreditTransactionsApi({ status: 'All', search: searchQuery }),
            ]);

            setSummary(nextSummary || {
                totalCreditReceivables: 0,
                unpaidAccounts: 0,
                partiallyPaidAccounts: 0,
                paidAccounts: 0,
                overdueAccounts: 0,
            });
            setRows(Array.isArray(nextRows) ? nextRows : []);
        } catch (error) {
            showPageLoadError(showToast, error, 'credit-load');
        } finally {
            setIsLoading(false);
        }
    }, [searchQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        const unsubscribe = subscribeRealtimeEvent('credit-transactions.updated', () => {
            void loadData();
        });
        return () => unsubscribe();
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
            if (userRole === ROLES.CASHIER) {
                const cashierName = getCreditProcessorDisplayName(row).toLowerCase();
                const currentCashier = String(currentUserName || 'Cashier').trim().toLowerCase();
                if (cashierName && cashierName !== currentCashier) {
                    return false;
                }
            }

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
    }, [rows, searchQuery, statusFilter, customerFilter, processedByFilter, userRole, currentUserName, ROLES, dateRange, specificDate, customStartDate, customEndDate, sortOrder]);

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
            const detail = await getCreditTransactionByIdApi(row._id);
            setSelectedRecord(detail);
            setIsDetailsOpen(true);
        } catch (error) {
            showPageLoadError(showToast, error, 'credit-details');
        }
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

    const openCreditReceiptPreview = (record, { isReprint = true } = {}) => {
        if (!isFullyPaidCreditTransaction(record)) return;

        setCreditReceiptPrintStatus('idle');
        setCreditReceiptPreview({
            record,
            transaction: buildCreditReceiptTransaction(record),
            isReprint,
        });
    };

    const closeCreditReceiptPreview = () => {
        if (creditReceiptPrintInFlightRef.current) return;
        setCreditReceiptPreview(null);
        setCreditReceiptPrintStatus('idle');
    };

    const printCreditReceipt = async () => {
        if (!creditReceiptPreview?.transaction || creditReceiptPrintInFlightRef.current) return;

        creditReceiptPrintInFlightRef.current = true;
        setCreditReceiptPrintStatus('printing');
        try {
            await printReceipt({
                transaction: creditReceiptPreview.transaction,
                settings: appSettings,
                isReprint: creditReceiptPreview.isReprint,
            });
            setCreditReceiptPrintStatus('success');
            showToast('Print Success', 'Receipt sent to the thermal printer.', 'success', 'credit-receipt-print-success');
        } catch (error) {
            setCreditReceiptPrintStatus('idle');
            const details = error?.message || 'Unable to print the paid Credit receipt.';
            showToast('Print Failed', `${details} The transaction remains Paid; you can retry from View Details.`, 'error', 'credit-receipt-print-error');
        } finally {
            creditReceiptPrintInFlightRef.current = false;
        }
    };

    const clearProofSelection = () => {
        setProofFile(null);
        setProofPreviewUrl('');
        setProofError('');
        if (proofInputRef.current) proofInputRef.current.value = '';
    };

    const handleProofSelection = (file) => {
        if (!file) return;

        if (!ACCEPTED_PROOF_MIME_TYPES.has(String(file.type || '').toLowerCase())) {
            clearProofSelection();
            setProofError('Proof of Payment must be a JPG, JPEG, or PNG image.');
            return;
        }
        if (file.size > MAX_PROOF_OF_PAYMENT_SIZE) {
            clearProofSelection();
            setProofError('Proof of Payment must be 5 MB or smaller.');
            return;
        }

        setProofFile(file);
        setProofPreviewUrl(URL.createObjectURL(file));
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

        creditMutationInFlightRef.current = true;
        setIsCancellingCredit(true);
        try {
            await cancelCreditTransactionApi(markPaidTarget._id, { reason });
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

        const amount = Number(markPaidForm.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
            showToast('Invalid Amount', 'Enter a valid payment amount.', 'error', 'credit-payment-validation');
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
            showToast('Missing Payment Method', 'Enter the other payment method.', 'error', 'credit-payment-method-validation');
            return;
        }

        if (!proofFile) {
            setProofError('Proof of Payment is required.');
            return;
        }

        const maxAllowedExtension = Number(markPaidForm.maxExtensionDays || 0);
        if (extensionInputError) {
            showToast('Invalid Extension', extensionInputError, 'error', 'credit-mark-paid-validation');
            return;
        }
        if (extensionDays > maxAllowedExtension) {
            showToast('Extension Limit', `Maximum extension is ${maxAllowedExtension} day(s).`, 'error', 'credit-mark-paid-validation');
            return;
        }

        creditMutationInFlightRef.current = true;
        setIsSavingMarkPaid(true);
        try {
            const paidTransactionId = markPaidTarget._id;
            await markCreditTransactionPaidApi(paidTransactionId, {
                method: paymentMethod,
                paymentDate: markPaidForm.paymentDate,
                extensionDays,
                note: markPaidForm.note,
                proofFile,
                clientRequestId: markPaidRequestIdRef.current || (markPaidRequestIdRef.current = createClientRequestId('credit-payment')),
            });
            showToast('Updated', 'Account marked as fully paid.', 'success', 'credit-mark-paid');
            setIsMarkPaidModalOpen(false);
            setMarkPaidTarget(null);
            clearProofSelection();
            markPaidRequestIdRef.current = '';
            try {
                const finalizedRecord = await getCreditTransactionByIdApi(paidTransactionId);
                openCreditReceiptPreview(finalizedRecord, { isReprint: false });
            } catch (receiptError) {
                showToast('Receipt Load Failed', `${receiptError.message || 'Unable to load the finalized receipt.'} The transaction remains Paid; open View Details to retry.`, 'error', 'credit-receipt-load-error');
            }
            await loadData();
        } catch (error) {
            showToast('Update Failed', error.message || 'Unable to mark account as fully paid.', 'error', 'credit-mark-paid');
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
            <div className="flex h-auto flex-col gap-3 rounded-2xl border border-slate-300 bg-slate-200/50 p-4 shadow-inner md:h-full md:min-h-0">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-gray-200 pb-3">
                    <div>
                        <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Credit Transactions</p>
                        <p className="text-gray-500 font-medium text-[11px] md:text-xs">Track receivables, overdue accounts, and payment collections.</p>
                    </div>

                </div>


                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                    <div className="bg-white rounded-xl border border-gray-100 p-3">
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
                    <div className="bg-white rounded-xl border border-gray-100 p-3">
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
                    <div className="bg-white rounded-xl border border-gray-100 p-3">
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
                    <div className="bg-white rounded-xl border border-gray-100 p-3">
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

                <div className="flex flex-wrap items-center gap-2">
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
                    <div className="relative z-30 w-full sm:w-auto flex items-center gap-2">
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

                {isFilterPanelOpen && (
                    <div className="fixed inset-0 z-20 bg-transparent" onClick={() => setIsFilterPanelOpen(false)} />
                )}

                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain max-xl:overflow-x-auto max-xl:overscroll-x-contain">
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
                                    <td className="p-8 text-center border border-gray-200" colSpan={10}>
                                        <div className="flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-300 rounded-3xl p-8 bg-gray-50/50">
                                            <div className="bg-white p-4 rounded-full mb-4 shadow-sm ring-1 ring-gray-200">
                                                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 7h18M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zm2 9h4" />
                                                </svg>
                                            </div>
                                            <h3 className="text-lg font-semibold text-gray-900 mb-1">No credit transactions found</h3>
                                            <p className="text-gray-500 text-sm">Try a different search keyword or status filter.</p>
                                        </div>
                                    </td>
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
                                    <tr key={row._id} className={`${getAttentionRowClass(displayStatus)} group transition-colors duration-150`}>
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
                                                    variant="positive"
                                                    label="Mark as Paid"
                                                >
                                                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
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

            {isDetailsOpen && selectedRecord && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-3xl bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                            <div>
                                <h3 className="font-semibold text-gray-900">Credit Transaction Details</h3>
                                <p className="text-xs text-gray-500">{selectedRecord.creditTransactionId} - {selectedRecord.customerName}</p>
                                <p className="text-[10px] text-gray-400 mt-0.5">Order: {selectedRecord.orderReference || '-'} | Cashier: {getCreditProcessorDisplayName(selectedRecord)}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {String(selectedRecord.status || '').toLowerCase() === 'cancelled' && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border bg-rose-100 text-rose-800 border-rose-200">
                                        Cancelled
                                    </span>
                                )}
                                <button onClick={() => setIsDetailsOpen(false)} className="text-gray-400 hover:text-gray-600">Close</button>
                            </div>
                        </div>
                        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
                            <div>
                                <h4 className="mb-2 text-xs font-semibold tracking-wider text-gray-500">Transaction Information</h4>
                                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Credit ID</p>
                                        <div className="mt-0.5 whitespace-nowrap"><IdentifierChip>{selectedRecord.creditTransactionId}</IdentifierChip></div>
                                    </div>
                                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Order Reference</p>
                                        <div className="mt-0.5">{selectedRecord.orderReference ? <IdentifierChip>{selectedRecord.orderReference}</IdentifierChip> : '-'}</div>
                                    </div>
                                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Customer</p>
                                        <p className="font-semibold text-gray-900">{selectedRecord.customerName || '-'}</p>
                                    </div>
                                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Order Date</p>
                                        <p className="font-semibold text-gray-900">{formatDateShort(getOrderDate(selectedRecord))}</p>
                                    </div>
                                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Due Date</p>
                                        <p className="font-semibold text-gray-900">{formatDateShort(selectedRecord.dueDate)}</p>
                                        <span className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(selectedDisplayStatus)}`}>
                                            {selectedDisplayStatus}
                                        </span>
                                    </div>
                                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Date Paid</p>
                                        <p className="font-semibold text-gray-900">{getDatePaid(selectedRecord) ? formatDateShort(getDatePaid(selectedRecord)) : '—'}</p>
                                    </div>
                                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Processed By</p>
                                        <p className="font-semibold text-gray-900">{getCreditProcessorDisplayName(selectedRecord)}</p>
                                    </div>
                                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Payment Method</p>
                                        <p className="font-semibold capitalize text-gray-900">{getCreditPaymentMode(selectedRecord)}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Total</p>
                                    <p className="font-semibold text-gray-900">{formatMoney(selectedRecord.totalAmount)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Paid</p>
                                    <p className="font-semibold text-gray-900">{formatMoney(selectedRecord.amountPaid)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Remaining</p>
                                    <p className="font-semibold text-gray-900">{formatMoney(selectedRecord.remainingBalance)}</p>
                                </div>
                            </div>

                            {String(selectedRecord.status || '').toLowerCase() === 'paid' && (
                                <div>
                                    <h4 className="mb-2 text-xs font-semibold tracking-wider text-gray-500">Paid Payment Details</h4>
                                    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                                        <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Payment Date</p>
                                            <p className="font-semibold text-gray-900">{getDatePaid(selectedRecord) ? formatDateShort(getDatePaid(selectedRecord)) : '-'}</p>
                                        </div>
                                        <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Payment Method</p>
                                            <p className="font-semibold capitalize text-gray-900">{getCreditPaymentMode(selectedRecord)}</p>
                                        </div>
                                        <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Proof of Payment</p>
                                            {selectedRecord.proofOfPayment ? (
                                                <button
                                                    type="button"
                                                    onClick={handleViewProof}
                                                    className="mt-0.5 text-xs font-semibold text-gray-900 underline underline-offset-2 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-900/20 rounded"
                                                >
                                                    View Proof
                                                </button>
                                            ) : (
                                                <p className="font-semibold text-gray-500">Not Available</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div>
                                <h4 className="text-xs font-semibold tracking-wider text-gray-500 mb-2">Order Items</h4>
                                <div className="border border-gray-200 rounded-lg overflow-hidden">
                                    <table className="w-full text-xs">
                                        <thead className="bg-gray-50 border-b border-gray-200">
                                            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                                                <th className="px-2 py-1.5">Item</th>
                                                <th className="px-2 py-1.5 text-center">Qty</th>
                                                <th className="px-2 py-1.5 text-right">Unit</th>
                                                <th className="px-2 py-1.5 text-right">Subtotal</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(selectedRecord.orderId?.items || []).length === 0 ? (
                                                <tr>
                                                    <td className="px-2 py-3 text-gray-500 text-center" colSpan={4}>No order items available.</td>
                                                </tr>
                                            ) : (
                                                (selectedRecord.orderId?.items || []).map((item, idx) => (
                                                    <tr key={`${item.code || item.name || 'item'}-${idx}`} className="border-b border-gray-100">
                                                        <td className="px-2 py-1.5">
                                                            <div className="font-semibold text-gray-900">{item.name || 'Item'}</div>
                                                            <div className="text-[10px] text-gray-500">{item.code || '-'}</div>
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center font-semibold">{item.quantity}</td>
                                                        <td className="px-2 py-1.5 text-right">{formatMoney(item.unitPrice)}</td>
                                                        <td className="px-2 py-1.5 text-right font-semibold">{formatMoney(item.subtotal)}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                        </div>
                        {isFullyPaidCreditTransaction(selectedRecord) && (
                            <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-2.5">
                                <button type="button" onClick={() => setIsDetailsOpen(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-100">Close</button>
                                <button type="button" onClick={() => openCreditReceiptPreview(selectedRecord, { isReprint: true })} className="rounded-lg border-2 border-gray-900 bg-gray-900 px-3 py-2 text-xs font-semibold text-white shadow-md transition-all hover:opacity-90">Print Receipt</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {creditReceiptPreview?.transaction && (
                <ReceiptPreviewModal
                    transaction={creditReceiptPreview.transaction}
                    settings={appSettings}
                    subtitle={`Paid Credit ${creditReceiptPreview.record.creditTransactionId} finalized receipt`}
                    isReprint={creditReceiptPreview.isReprint}
                    printStatus={creditReceiptPrintStatus}
                    printLabel="Print Receipt"
                    contentId="credit-transaction-receipt-content"
                    onClose={closeCreditReceiptPreview}
                    onPrint={printCreditReceipt}
                />
            )}

            {proofLightbox && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Proof of Payment preview">
                    <div className="relative max-h-full max-w-4xl">
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

            {isMarkPaidModalOpen && markPaidTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-5 py-3.5 border-b border-gray-100 bg-linear-to-r from-gray-50 to-white flex items-center justify-between rounded-t-2xl">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
                                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                </div>
                                <div>
                                    <h3 className="font-semibold text-sm text-gray-900 leading-tight">{markPaidModalMode === 'extendOnly' ? 'Extend Day Term' : 'Mark as Paid'}</h3>
                                    <p className="text-gray-400 text-[10px] mt-0.5">{markPaidModalMode === 'extendOnly' ? 'Update the due date without recording payment.' : 'Confirm and complete this credit transaction.'}</p>
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
                                            <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Amount</label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                min="0.01"
                                                step="0.01"
                                                value={markPaidForm.amount}
                                                readOnly
                                                className="mt-1 w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-900"
                                            />
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
                                <div>
                                    <label htmlFor="credit-payment-proof" className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Proof of Payment <span className="text-rose-500">*</span></label>
                                    <input
                                        id="credit-payment-proof"
                                        ref={proofInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                                        onChange={(event) => handleProofSelection(event.target.files?.[0])}
                                        className="sr-only"
                                    />
                                    {proofFile ? (
                                        <div className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1.5">
                                            <img src={proofPreviewUrl} alt="Selected proof preview" className="h-8 w-8 shrink-0 rounded-md border border-gray-200 object-cover" />
                                            <p className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700" title={proofFile.name}>{proofFile.name}</p>
                                            <button
                                                type="button"
                                                onClick={() => proofInputRef.current?.click()}
                                                className="text-[11px] font-semibold text-gray-700 hover:text-gray-950 focus:outline-none focus:ring-2 focus:ring-gray-900/20 rounded"
                                            >
                                                Replace
                                            </button>
                                            <button
                                                type="button"
                                                onClick={clearProofSelection}
                                                className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-300 rounded"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => proofInputRef.current?.click()}
                                            className={`mt-1 flex w-full items-center justify-center rounded-lg border border-dashed px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 ${proofError ? 'border-rose-400 bg-rose-50 text-rose-700 focus:ring-rose-200' : 'border-gray-300 bg-gray-50 text-gray-700 hover:border-gray-400 hover:bg-gray-100 focus:ring-gray-900/20'}`}
                                        >
                                            Select Proof
                                        </button>
                                    )}
                                    <p className={`mt-1 text-[10px] ${proofError || !proofFile ? 'text-rose-600' : 'text-gray-400'}`}>
                                        {proofError || (!proofFile ? 'Proof of Payment is required.' : 'JPG, JPEG, or PNG. Maximum 5 MB.')}
                                    </p>
                                </div>
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
                                        disabled={isSavingMarkPaid || isSavingExtensionOnly || isCancellingCredit || Boolean(extensionInputError) || !proofFile}
                                        className={`flex-1 py-2.5 rounded-xl text-xs font-semibold text-white shadow-md transition-all transform ${(isSavingMarkPaid || isSavingExtensionOnly || extensionInputError || !proofFile) ? 'bg-gray-500 cursor-not-allowed' : 'bg-gray-900 hover:opacity-90 hover:-translate-y-0.5'}`}
                                    >
                                        {isSavingMarkPaid ? 'Saving...' : 'Mark as Paid'}
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isCancelModalOpen && markPaidTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-200 dark:border-slate-700 dark:bg-slate-900">
                        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cancel Credit Order</h3>
                            <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Provide a reason before cancelling this credit transaction.</p>
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
                                    disabled={isCancellingCredit || !String(markPaidForm.cancelReason || '').trim()}
                                    className={`flex-1 rounded-xl border py-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 ${(isCancellingCredit || !String(markPaidForm.cancelReason || '').trim()) ? 'cursor-not-allowed border-rose-200 bg-rose-100 text-rose-400 dark:border-rose-950 dark:bg-rose-950/35 dark:text-rose-700' : 'border-rose-700 bg-rose-700 text-white hover:border-rose-800 hover:bg-rose-800 dark:border-rose-800 dark:bg-rose-900/70 dark:text-rose-100 dark:hover:bg-rose-900'}`}
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
