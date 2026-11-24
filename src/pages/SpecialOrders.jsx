import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Pagination from '../components/Pagination';
import IdentifierChip from '../components/IdentifierChip';
import ToolbarDropdown from '../components/ToolbarDropdown';
import OrderConfirmationModal from '../components/OrderConfirmationModal';
import SpecialOrderTransactionDetailsModal from '../components/SpecialOrderTransactionDetailsModal';
import { ExpiryBatchVerificationModal } from '../components/ExpiryBatchVerification';
import { isExpiryBatchVerificationConfirmed } from '../utils/expiryBatchVerification';
import TransactionReferenceModal from '../components/TransactionReferenceModal';
import FormalPriceQuotationModal from '../components/FormalPriceQuotationModal';
import SpecialOrderQuotationEditor from '../components/SpecialOrderQuotationEditor';
import ProductPhotoUploadArea from '../components/ProductPhotoUploadArea';
import EvidenceUploadField from '../components/EvidenceUploadField';
import { FulfillmentFields, InventorySkuPicker } from '../components/SpecialOrderPhaseOneFields';
import { fulfillmentDescription, hasInventoryLinkedItems, inventoryItemFromProduct } from '../utils/specialOrderPhaseOne';
import { getQuotationItemRemovalSummary, hasMeaningfulQuotationItemInput, removeQuotationFormItemById } from '../utils/quotationItemRemoval';
import { consolidateQuotationItems } from '../utils/quotationItemConsolidation';
import { validateLagunaDeliveryLocation } from '../utils/lagunaLocation';
import { showToast } from '../utils/toastHelper';
import TableSkeletonRows from '../components/TableSkeletonRows';
import ContextualEmptyState from '../components/ContextualEmptyState';
import { showPageLoadError } from '../utils/pageLoadError';
import { setFormValidationErrors } from '../utils/formValidationNavigation';
import { validateSpecialOrderItemRows } from '../utils/specialOrderItemValidation';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import {
  createSpecialOrderApi,
  createPartnerApi,
  finalizeSpecialOrderWithReferenceApi,
  getSpecialOrderReceiptApi,
  listPartnersApi,
  listSpecialOrdersApi,
  getSpecialOrderStockAvailabilityApi,
  getSpecialOrderPaymentsApi,
  recordSpecialOrderDownPaymentApi,
  recordSpecialOrderPaymentApi,
  getSpecialOrderPaymentProofApi,
  completeSpecialOrderProcessingApi,
  reserveSpecialOrderStockApi,
  releaseSpecialOrderStockApi,
  cancelReservedSpecialOrderApi,
  listSpecialOrderQuotationsApi,
  getSpecialOrderQuotationDocumentApi,
  prepareSpecialOrderQuotationApi,
  updateSpecialOrderQuotationApi,
  issueSpecialOrderQuotationApi,
  decideSpecialOrderQuotationApi,
  reviseSpecialOrderQuotationApi,
  uploadSpecialOrderQuotationImagesApi,
  removeSpecialOrderQuotationImageApi,
  getSpecialOrderQuotationImageApi,
  getSaleSupportingDocumentApi,
  listProductExpiryBatchesApi,
} from '../services/inventoryApi';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { formatCurrency } from '../utils/numberFormat';
import { createClientRequestId } from '../utils/clientRequestId';
import { downloadSpecialOrderTransactionPdf } from '../utils/specialOrderPdf';
import { getAttentionRowClass } from '../utils/tableStatusStyle';
import { normalizeHumanReadable } from '../utils/textNormalization';
import { getTransactionReferenceNumberError, normalizeTransactionReferenceInput } from '../utils/transactionReference';
import { buildSpecialOrderFormalQuotationModel } from '../utils/formalQuotation';
import { inventoryProductPhotosForSelection, isProductImageReference, productImageEntries, quotationPhotoSelections } from '../utils/specialOrderProductImages.mjs';
import { acceptedQuotationTransaction, approvedSpecialOrderTaxTreatment, createQuotationDraft, createQuotationRequestGate, quotationCapabilities, quotationDraftSummary, quotationOrderView } from '../utils/specialOrderQuotation';
import { canViewSpecialOrderTransaction, getPhaseFiveTableNextAction } from '../utils/specialOrderTableActions';
import logo from '../assets/logo.png';
import {
  formatMoneyInput,
  isWholeNumberInput,
  parseMoneyToCentavos,
  preventInvalidMoneyKeyDown,
  preventInvalidMoneyPaste,
  preventInvalidWholeNumberKeyDown,
  preventInvalidWholeNumberPaste,
  sanitizeMoneyInput,
  sanitizeWholeNumberInput,
} from '../utils/numericInput';

const statusOptions = ['All', 'Pending', 'In Progress', 'Completed', 'Cancelled'];
const DEFAULT_QUOTATION_SIGNATORY = 'John Michael Lu';
const SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS = 1;
const SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS = 60;
const parseDownPaymentPercentageBasisPoints = (value) => {
  const text = String(value ?? '').trim();
  const normalizedText = text.startsWith('.') ? `0${text}` : text;
  const match = normalizedText.match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
  return basisPoints > 0 && basisPoints <= 10000 ? basisPoints : null;
};
const getSpecialOrderDownPaymentInput = (amount, percentage = '50') => {
  const totalCentavos = parseMoneyToCentavos(String(amount ?? ''));
  const percentageBasisPoints = parseDownPaymentPercentageBasisPoints(percentage);
  if (totalCentavos === null || percentageBasisPoints === null) return '';
  const downPaymentCentavos = (BigInt(totalCentavos) * BigInt(percentageBasisPoints) + 5000n) / 10000n;
  return downPaymentCentavos <= BigInt(Number.MAX_SAFE_INTEGER)
    ? (Number(downPaymentCentavos) / 100).toFixed(2)
    : '';
};
const getSpecialOrderRemainingBalanceCentavos = (amount, percentage = '50') => {
  const totalCentavos = parseMoneyToCentavos(String(amount ?? ''));
  const downPaymentCentavos = parseMoneyToCentavos(getSpecialOrderDownPaymentInput(amount, percentage));
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos < 1 || !Number.isSafeInteger(downPaymentCentavos)
    || downPaymentCentavos < 0 || downPaymentCentavos > totalCentavos) return null;
  return totalCentavos - downPaymentCentavos;
};
const INPUT_CLASS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900';
const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold text-gray-500';
const QUOTATION_INPUT_CLASS = 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60';
const QUOTATION_FIELD_LABEL_CLASS = 'mb-1 block text-[11px] font-semibold text-slate-600';
const QUOTATION_FORM_INPUT_CLASS = 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60 read-only:bg-slate-50';
const QUOTATION_FORM_PRIMARY_BUTTON_CLASS = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const QUOTATION_FORM_COMPACT_PRIMARY_BUTTON_CLASS = 'inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const QUOTATION_FORM_SECONDARY_BUTTON_CLASS = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_BUTTON_CLASS = 'rounded-lg border-2 border-gray-900 bg-gray-900 px-3 py-2 text-xs font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';
const SECONDARY_BUTTON_CLASS = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';
const DETAIL_PRIMARY_BUTTON_CLASS = 'inline-flex min-h-10 items-center justify-center rounded-lg border-2 border-gray-900 bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const DETAIL_SECONDARY_BUTTON_CLASS = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const SpecialOrderActionIcon = ({ icon }) => {
  const paths = icon === 'eye'
    ? <><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></>
    : icon === 'file-text'
      ? <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>
      : icon === 'clipboard-check'
        ? <><rect x="5" y="4" width="14" height="18" rx="2" /><path d="M9 4.5V3h6v1.5M8 13l2.5 2.5L16 10" /></>
        : icon === 'circle-check'
          ? <><circle cx="12" cy="12" r="10" /><path d="m8 12 2.5 2.5L16 9" /></>
      : null;
  return paths ? <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0">{paths}</svg> : null;
};

const getSpecialOrderActionButtonClass = (action) => `inline-flex h-[30px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border px-2 text-[10px] font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${action.primary || action.label === 'View Details' ? 'border-slate-900 bg-slate-900 text-white hover:border-slate-700 hover:bg-slate-700 disabled:hover:border-slate-900 disabled:hover:bg-slate-900' : 'border-slate-300 bg-white text-slate-900 hover:border-slate-500 hover:bg-slate-100 disabled:hover:border-slate-300 disabled:hover:bg-white'}`;

const SpecialOrderRowActionButton = ({ action, busy, loadingAction, fullWidth = false, stopPropagation = false, menuItem = false, onAction }) => {
  const isLoading = action.type === 'checking' || loadingAction === action.loadingKey;
  const disabledReason = action.disabledReason || (action.disabled ? action.reason : '');
  return (
    <span title={disabledReason || undefined} className={`${fullWidth || menuItem ? 'w-full' : ''} ${disabledReason ? 'inline-flex' : ''}`}>
      <button
        type="button"
        disabled={busy || Boolean(action.disabled)}
        role={menuItem ? 'menuitem' : undefined}
        tabIndex={menuItem ? -1 : undefined}
        aria-label={disabledReason ? `${action.label}. ${disabledReason}` : action.label}
        title={disabledReason || undefined}
        onClick={(event) => {
          if (stopPropagation || menuItem) event.stopPropagation();
          if (!busy && !action.disabled) {
            onAction?.();
            void action.run();
          }
        }}
        className={menuItem
          ? `inline-flex min-h-9 w-full items-center justify-start gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50 ${action.primary ? 'bg-slate-900 text-white hover:bg-slate-800' : 'text-slate-800 hover:bg-slate-100'}`
          : `${getSpecialOrderActionButtonClass(action)} ${action.label === 'View Details' ? 'min-w-[96px]' : ''} ${fullWidth ? 'min-h-10 h-auto w-full gap-1.5 whitespace-nowrap px-2 py-2 text-xs' : 'gap-1'}`}
      >
        {isLoading && <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border border-current border-r-transparent" />}
        <SpecialOrderActionIcon icon={action.icon} />{action.label}
      </button>
    </span>
  );
};

const SpecialOrderActionMenu = ({ actions, orderNumber, disabled, loadingAction }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const closeMenu = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;

    const updatePosition = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      const menuRect = menuRef.current?.getBoundingClientRect();
      if (!triggerRect || !menuRect) return;

      const margin = 8;
      const gap = 4;
      const left = Math.max(margin, Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - margin));
      const belowSpace = window.innerHeight - triggerRect.bottom - gap - margin;
      const aboveSpace = triggerRect.top - gap - margin;
      const opensAbove = belowSpace < menuRect.height && aboveSpace > belowSpace;
      const top = opensAbove
        ? Math.max(margin, triggerRect.top - gap - menuRect.height)
        : Math.min(triggerRect.bottom + gap, window.innerHeight - menuRect.height - margin);
      setPosition((current) => current?.left === left && current?.top === top ? current : { left, top });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, actions.length]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isOpen, closeMenu]);

  useEffect(() => {
    if (isOpen && position) menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [isOpen, position]);

  const handleMenuKeyDown = (event) => {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])];
    const currentIndex = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[nextIndex]?.focus();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
      const focusable = [...document.querySelectorAll(selector)]
        .filter((element) => !menuRef.current?.contains(element) && element.getClientRects().length > 0);
      const triggerIndex = focusable.indexOf(triggerRef.current);
      const targetIndex = triggerIndex + (event.shiftKey ? -1 : 1);
      closeMenu();
      focusable[targetIndex]?.focus();
    }
  };

  if (!actions.length) return null;

  const menu = isOpen && (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={`Actions for special order ${orderNumber}`}
      onKeyDown={handleMenuKeyDown}
      className="fixed z-[70] w-52 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
    >
      <div className="flex flex-col gap-0.5">
        {actions.map((action) => (
          <SpecialOrderRowActionButton
            key={action.label}
            action={action}
            busy={disabled}
            loadingAction={loadingAction}
            menuItem
            onAction={closeMenu}
          />
        ))}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={`More actions for special order ${orderNumber}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        title={`More actions for ${orderNumber}`}
        onClick={(event) => { event.stopPropagation(); setPosition(null); setIsOpen((open) => !open); }}
        onKeyDown={(event) => {
          if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setPosition(null);
            setIsOpen(true);
          }
        }}
        className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition-colors hover:border-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
      </button>
      {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}
    </>
  );
};

const getQuotationFormInputClass = (hasError) => `${QUOTATION_FORM_INPUT_CLASS}${hasError ? ' border-rose-600 bg-rose-50 focus:border-rose-700 focus:ring-rose-500' : ''}`;
const customerNameKey = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const blobToDataUrl = async (blob) => {
  if (blob.type === 'image/webp') {
    // jsPDF embeds PNG/JPEG consistently across browsers; retain WebP in storage.
    const url = URL.createObjectURL(blob);
    try {
      const decoded = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('The saved WebP photo could not be decoded.'));
        image.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = decoded.naturalWidth;
      canvas.height = decoded.naturalHeight;
      canvas.getContext('2d').drawImage(decoded, 0, 0);
      return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  }
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
};
const hydrateQuotationImage = async (orderId, quotationId, itemId, image) => ({
  ...image,
  src: image.sourceUrl || await blobToDataUrl(await getSpecialOrderQuotationImageApi(orderId, quotationId, itemId, image.key)),
});
const hydrateQuotationItems = async (orderId, quotationId, items) => Promise.all((items || []).map(async (item) => ({
  ...item,
  images: await Promise.all((item.images || []).map((image) => hydrateQuotationImage(orderId, quotationId, item.itemId, image))),
})));

const getTodayInputDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTodayManilaInputDate = () => {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type) => values.find((value) => value.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const isTodayOrLater = (value) => {
  const matchedDate = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matchedDate) return false;

  const [, year, month, day] = matchedDate;
  const selectedDate = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    selectedDate.getFullYear() !== Number(year)
    || selectedDate.getMonth() !== Number(month) - 1
    || selectedDate.getDate() !== Number(day)
  ) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return selectedDate >= today;
};

const FieldError = ({ id, message }) => message ? (
  <p id={id} className="mt-1 text-[11px] font-medium text-red-600" role="alert">{message}</p>
) : null;

const createFormItem = (item = {}) => ({
  __rowId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  itemId: globalThis.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)}`,
  photos: [],
  itemType: 'custom',
  inventoryProduct: '',
  sku: '',
  originalUnitPrice: null,
  priceOverrideReason: '',
  itemName: '',
  description: '',
  sellingUnit: '',
  expiryDate: '',
  expiryTrackingEnabled: false,
  expiryTrackingPeriodId: '',
  quotationExpirySelections: [],
  quantity: 1,
  supplierId: '',
  supplierName: '',
  purchaseCost: '',
  sellingPrice: '',
  expectedArrivalDate: '',
  remarks: '',
  ...item,
});

const createEmptyForm = () => ({
  customerId: '',
  customerName: '',
  customerVatExempt: false,
  taxTreatment: '',
  remarks: '',
  fulfillment: { method: '', addressLine: '', barangay: '', cityMunicipality: '', province: '', preferredDate: '' },
  quotationDetails: { attentionName: '', attentionPosition: '', authorizedSignatoryName: '' },
  items: [createFormItem()],
});

const serializeQuotationFormValue = (value) => {
  if (Array.isArray(value)) return value.map(serializeQuotationFormValue);
  if (typeof File !== 'undefined' && value instanceof File) return { name: value.name, size: value.size, type: value.type, lastModified: value.lastModified };
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (key !== '__rowId') result[key] = serializeQuotationFormValue(value[key]);
      return result;
    }, {});
  }
  return value;
};

const quotationFormSnapshot = (formValue, customerQuery) => JSON.stringify({
  form: serializeQuotationFormValue(formValue),
  customerQuery,
});

const formatMoney = formatCurrency;
const formatPaymentMethod = (method) => ({ cash: 'Cash', gcash: 'GCash', cheque: 'Cheque', 'bank transfer': 'Bank Transfer', Other: 'Other' }[method] || method);

const formatDate = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleDateString();
};

const upsertFinalizedTransaction = (transactions, transaction) => {
  const transactionSourceId = String(transaction?.sourceId || '');
  const transactionId = String(transaction?.id || '');
  const index = transactions.findIndex((candidate) => (
    (transactionSourceId && String(candidate?.sourceId || candidate?._id || '') === transactionSourceId)
    || (transactionId && String(candidate?.id || '') === transactionId)
  ));
  if (index < 0) return [transaction, ...transactions];
  return transactions.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...transaction } : candidate);
};

const getStatusBadgeClass = (status) => {
  if (status === 'Completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (['Pending', 'In Progress', 'Ready for Pickup'].includes(status)) return 'border-amber-300 bg-amber-50 text-amber-800';
  if (status === 'Cancelled') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-gray-200 bg-gray-100 text-gray-600';
};

const getOrderItems = (order) => {
  if (Array.isArray(order?.items) && order.items.length > 0) return order.items;
  if (!order) return [];
  return [{
    itemName: order.itemName || '',
    description: order.description || '',
    quantity: Number(order.quantity || 0),
    supplierId: order.supplier ? String(order.supplier?._id || order.supplier) : '',
    supplierName: order.supplierName || '',
    purchaseCost: order.purchaseCost ?? 0,
    sellingPrice: order.sellingPrice ?? 0,
    expectedArrivalDate: order.expectedArrivalDate || null,
    remarks: order.remarks || '',
  }];
};

const summarizeOrder = (order) => {
  const view = quotationOrderView(order);
  const items = getOrderItems(view);
  return {
    items,
    itemCount: items.length,
    quantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    total: view?.quotation ? Number(view.quotation.total) : items.reduce((sum, item) => sum + (Number(item.sellingPrice || 0) * Number(item.quantity || 0)), 0),
    expectedDate: items.find((item) => item.expectedArrivalDate)?.expectedArrivalDate || order?.expectedArrivalDate,
  };
};

const SupplierCombobox = ({ supplierId, supplierName, suppliers, isLoading, disabled, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(supplierName || '');

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSuppliers = suppliers.filter((supplier) => (
    String(supplier?.name || '').toLowerCase().includes(normalizedQuery)
  ));

  const clearSelection = () => {
    setQuery('');
    onSelect(null);
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          value={query}
          disabled={disabled}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            if (supplierId) onSelect(null);
            setIsOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 150)}
          className={`${QUOTATION_INPUT_CLASS} pr-8`}
          placeholder="Search suppliers"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
        />
        {(query || supplierId) && !disabled && (
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={clearSelection} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700" aria-label="Clear supplier">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>
      {isOpen && !disabled && (
        <div className="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {isLoading ? (
            <p className="px-3 py-2 text-xs text-gray-500">Loading suppliers...</p>
          ) : suppliers.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">No supplier partners available</p>
          ) : filteredSuppliers.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">No suppliers found</p>
          ) : filteredSuppliers.map((supplier) => {
            const id = String(supplier._id || supplier.id || '');
            return (
              <button key={id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const name = String(supplier.name || '').trim(); onSelect({ id, name }); setQuery(name); setIsOpen(false); }} className="block w-full px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
                {supplier.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const CustomerCombobox = ({ customerId, query, onQueryChange, customers, loading, disabled, error, inputRef, onSelect, onAdd, canAdd }) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = customers.filter((customer) => String(customer.name || '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choose = (customer) => {
    onSelect(customer);
    onQueryChange(customer.name);
    setOpen(false);
    setActive(-1);
  };
  return <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <input ref={inputRef} name="customerName" data-validation-key="customerName" data-validation-aliases="customerId" type="text" role="combobox" aria-label="Customer" aria-controls="special-order-customer-options" aria-autocomplete="list" aria-expanded={open} aria-activedescendant={open && active >= 0 ? `special-order-customer-option-${active}` : undefined} aria-invalid={Boolean(error)} aria-describedby={error ? 'special-order-customer-error' : undefined} value={query} disabled={disabled} placeholder="Search regular customers" autoComplete="off" className={`${QUOTATION_INPUT_CLASS}${error ? ' border-red-500 bg-red-50 focus:border-red-600 focus:bg-white' : ''}`}
      onFocus={() => setOpen(true)} onChange={(event) => { onQueryChange(event.target.value); onSelect(null); setActive(-1); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive((index) => event.key === 'ArrowDown' ? Math.min(index + 1, matches.length - 1) : Math.max(index - 1, 0)); }
        if (event.key === 'Enter' && open && active >= 0 && matches[active]) { event.preventDefault(); choose(matches[active]); }
      }} />
    {open && !disabled && <div id="special-order-customer-options" role="listbox" className="absolute z-30 mt-1 max-h-[35dvh] w-full overflow-y-auto rounded-lg border border-slate-300 bg-white py-1 shadow-lg">
      {loading ? <p className="px-3 py-2 text-xs text-slate-500">Loading customers...</p> : matches.length ? matches.map((customer, index) => <button key={customer._id || customer.id} id={`special-order-customer-option-${index}`} role="option" aria-selected={String(customer._id || customer.id) === String(customerId)} type="button" onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(customer)} className={`block w-full px-3 py-2 text-left text-xs text-slate-800 hover:bg-slate-100 ${index === active ? 'bg-slate-100' : ''}`}>{customer.name}</button>) : <p className="px-3 py-2 text-xs text-slate-500">No regular customers found.</p>}
      {canAdd && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); onAdd(query); }} className="block w-full border-t border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500">+ Add Regular Customer</button>}
    </div>}
  </div>;
};

const LocalItemPhoto = ({ photo }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (isProductImageReference(photo)) return undefined;
    const reader = new FileReader();
    reader.onload = () => setSrc(String(reader.result || ''));
    reader.readAsDataURL(photo);
    return () => { reader.onload = null; if (reader.readyState === FileReader.LOADING) reader.abort(); };
  }, [photo]);
  const imageSrc = isProductImageReference(photo) ? photo.src : src;
  return imageSrc ? <img src={imageSrc} alt={photo.name || 'Product photo'} className="h-12 w-12 rounded-md border border-slate-200 bg-slate-50 object-contain" /> : null;
};

const ItemEditor = ({ item, index, itemCount, disabled, errors = {}, registerFieldRef, suppliers, isSuppliersLoading, inventory, categories = [], userRole, expiryBatchInfoByItemId = {}, onRetryExpiryInfo, onChange, onReplace, onSelectInventoryProduct, onRemove }) => {
  const itemId = String(item.itemId || item.__rowId);
  const itemFieldPrefix = `items.${itemId}`;
  const expiryInfo = expiryBatchInfoByItemId[itemId] || {};
  const expiryData = expiryInfo.data;
  const expiryBatches = Array.isArray(expiryData?.batches) ? expiryData.batches : [];
  const expiryOptions = new Map((expiryData?.batchOptions || []).map((batch) => [String(batch.batch), batch]));
  const selectedExpiry = new Map((item.quotationExpirySelections || []).map((selection) => [String(selection.batch), selection]));
  const fieldId = (field) => `special-order-item-${itemId}-${field}-error`;
  const inputProps = (field) => ({
    ref: (element) => registerFieldRef(`${itemFieldPrefix}.${field}`, element),
    name: `${itemFieldPrefix}.${field}`,
    'data-validation-key': `${itemFieldPrefix}.${field}`,
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? fieldId(field) : undefined,
  });

  return (
    <div ref={(element) => registerFieldRef(itemFieldPrefix, element)} tabIndex={-1} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
        <span className="text-sm font-semibold text-slate-900">Item {index + 1}</span>
        {itemCount > 1 && (
          <button type="button" onClick={(event) => onRemove(item.itemId, event.currentTarget)} disabled={disabled} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50">
            Remove
          </button>
        )}
      </div>
      <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1" role="group" aria-label={`Item ${index + 1} source`}>
        {[['custom', 'Custom Product'], ['inventory', 'Existing Product']].map(([type, label]) => <button key={type} type="button" disabled={disabled} aria-pressed={item.itemType === type} onClick={() => { if (item.itemType !== type) onReplace(itemId, { ...createFormItem(), itemId: item.itemId, __rowId: item.__rowId, itemType: type, quantity: item.quantity }); }} className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${item.itemType === type ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}>{label}</button>)}
      </div>
      {item.itemType === 'inventory' && <div className="mb-3"><span className={QUOTATION_FIELD_LABEL_CLASS}>Select exact inventory SKU <span className="text-rose-700">*</span></span><InventorySkuPicker products={inventory} categories={categories} selectedSku={item.sku} disabled={disabled} name={`${itemFieldPrefix}.sku`} validationKey={`${itemFieldPrefix}.sku`} inputRef={inputProps('sku').ref} error={errors.sku} errorId={fieldId('sku')} onSelect={(product) => onSelectInventoryProduct(itemId, item, product)} /><FieldError id={fieldId('sku')} message={errors.sku} /></div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-12">
        <label className="sm:col-span-2 md:col-span-6">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Item name <span className="text-rose-700">*</span></span>
          <input {...inputProps('itemName')} value={item.itemName} readOnly={item.itemType === 'inventory'} onChange={(event) => onChange(itemId, 'itemName', event.target.value)} onBlur={(event) => onChange(itemId, 'itemName', normalizeHumanReadable(event.target.value))} className={getQuotationFormInputClass(errors.itemName)} placeholder="Item name" required />
          <FieldError id={fieldId('itemName')} message={errors.itemName} />
        </label>
        <label className="sm:col-span-2 md:col-span-6">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Supplier</span>
          <SupplierCombobox
            supplierId={item.supplierId}
            supplierName={item.supplierName}
            suppliers={suppliers}
            isLoading={isSuppliersLoading}
            disabled={disabled}
            onSelect={(supplier) => {
              onChange(itemId, 'supplierId', supplier?.id || '');
              onChange(itemId, 'supplierName', supplier?.name || '');
            }}
          />
        </label>
        <label className="md:col-span-3">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Quantity <span className="text-rose-700">*</span></span>
          <input {...inputProps('quantity')} type="text" inputMode="numeric" pattern="[0-9]*" min="1" value={item.quantity} onKeyDown={preventInvalidWholeNumberKeyDown} onPaste={preventInvalidWholeNumberPaste} onChange={(event) => onChange(itemId, 'quantity', sanitizeWholeNumberInput(event.target.value))} className={getQuotationFormInputClass(errors.quantity)} required />
          <FieldError id={fieldId('quantity')} message={errors.quantity} />
        </label>
        <label className="md:col-span-3">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Purchase Cost (Optional)</span>
          <input {...inputProps('purchaseCost')} type="text" inputMode="decimal" value={item.purchaseCost} onKeyDown={preventInvalidMoneyKeyDown} onPaste={preventInvalidMoneyPaste} onChange={(event) => onChange(itemId, 'purchaseCost', sanitizeMoneyInput(event.target.value))} onBlur={(event) => onChange(itemId, 'purchaseCost', formatMoneyInput(event.target.value))} className={getQuotationFormInputClass(errors.purchaseCost)} placeholder="If known" />
          <FieldError id={fieldId('purchaseCost')} message={errors.purchaseCost} />
        </label>
        <label className="md:col-span-3">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Unit Price (₱) <span className="text-rose-700">*</span></span>
          <input {...inputProps('sellingPrice')} type="text" inputMode="decimal" value={item.sellingPrice} readOnly={item.itemType === 'inventory' && !['admin', 'superadmin'].includes(userRole)} onKeyDown={preventInvalidMoneyKeyDown} onPaste={preventInvalidMoneyPaste} onChange={(event) => onChange(itemId, 'sellingPrice', sanitizeMoneyInput(event.target.value))} onBlur={(event) => onChange(itemId, 'sellingPrice', formatMoneyInput(event.target.value))} className={getQuotationFormInputClass(errors.sellingPrice)} placeholder="0.00" required />
          {item.itemType === 'inventory' && item.sku && <p className="mt-1 text-[10px] text-slate-500">Inventory price: {formatMoney(item.originalUnitPrice)}</p>}
          <FieldError id={fieldId('sellingPrice')} message={errors.sellingPrice} />
        </label>
        <label className="md:col-span-3">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Selling Unit <span className="text-rose-700">*</span></span>
          <input {...inputProps('sellingUnit')} value={item.sellingUnit || ''} readOnly={item.itemType === 'inventory'} onChange={(event) => onChange(itemId, 'sellingUnit', event.target.value)} className={getQuotationFormInputClass(errors.sellingUnit)} placeholder={item.itemType === 'custom' ? 'e.g. box or roll' : 'Saved unit'} required />
          <FieldError id={fieldId('sellingUnit')} message={errors.sellingUnit} />
        </label>
        {item.itemType === 'custom' && <label className="md:col-span-4">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Expiry Date (Optional)</span>
          <input {...inputProps('expiryDate')} type="date" value={item.expiryDate || ''} onChange={(event) => onChange(itemId, 'expiryDate', event.target.value)} className={getQuotationFormInputClass(errors.expiryDate)} />
          <FieldError id={fieldId('expiryDate')} message={errors.expiryDate} />
        </label>}
        {item.itemType === 'inventory' && item.expiryTrackingEnabled && <div className="sm:col-span-2 md:col-span-12 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-slate-800">Expiry Information</h4>
              <p className="mt-0.5 text-[11px] text-slate-600">Select available batch quantities to include in the quotation. This does not reserve or allocate stock.</p>
            </div>
            {expiryInfo.loading && <span className="text-[11px] text-slate-500" role="status">Loading verified batches…</span>}
            {expiryInfo.error && <button type="button" disabled={disabled} onClick={() => onRetryExpiryInfo(itemId, item.inventoryProduct)} className="text-[11px] font-semibold text-slate-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Retry batch details</button>}
          </div>
          {expiryInfo.error && <p className="mt-2 text-[11px] text-rose-700" role="alert">Verified batch information could not be loaded. Retry, or leave expiry unassigned.</p>}
          {!expiryInfo.loading && !expiryInfo.error && expiryData && expiryData.reconciled !== true && <p className="mt-2 text-[11px] text-amber-800">Batch balances are not verified, so no expiry dates can be selected for this quotation.</p>}
          {!expiryInfo.loading && !expiryInfo.error && expiryData?.reconciled === true && <div className="mt-2 space-y-1.5">
            {expiryBatches.length === 0 && <p className="text-[11px] text-slate-600">No active verified batches are available. Expiry will be confirmed when the order is fulfilled.</p>}
            {expiryBatches.map((batch) => {
              const id = String(batch._id || batch.batch);
              const option = expiryOptions.get(id);
              const available = Number(option?.availableQuantity || 0);
              const remaining = Number(batch.remainingQuantity || 0);
              const reserved = Number(batch.reservedQuantity || 0);
              const expired = String(batch.expiryDate || '') <= getTodayManilaInputDate();
              const unavailableReason = expired ? 'Expired' : remaining <= 0 ? 'Depleted' : reserved >= remaining ? 'Fully reserved' : 'Unavailable';
              const chosen = selectedExpiry.get(id);
              const label = batch.batchReference || batch.lotNumber || `Batch ${batch.batchId || ''}`;
              return <div key={id} className="grid grid-cols-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 text-[11px]">
                  <p className="truncate font-medium text-slate-800" title={label}>{label}</p>
                  <p className="text-slate-600">Expires {batch.expiryDate} · Available {Number.isSafeInteger(available) ? available : 0} {item.sellingUnit}</p>
                </div>
                {available > 0 ? <label className="flex items-center gap-2 text-[11px] text-slate-600">Quotation qty
                    <input type="number" min="0" max={available} step="1" inputMode="numeric" disabled={disabled || expiryInfo.loading} aria-label={`Quotation quantity from ${label}`} aria-invalid={Boolean(errors.quotationExpirySelections)} aria-describedby={errors.quotationExpirySelections ? fieldId('quotationExpirySelections') : undefined} value={chosen?.quantity ?? ''} onChange={(event) => {
                    const raw = event.target.value;
                    const quantity = raw === '' ? 0 : Number(raw);
                    const selections = (item.quotationExpirySelections || []).filter((selection) => String(selection.batch) !== id);
                    if (Number.isSafeInteger(quantity) && quantity > 0) selections.push({ batch: id, batchId: batch.batchId, batchReference: batch.batchReference || '', lotNumber: batch.lotNumber || '', expiryDate: batch.expiryDate, quantity });
                    onChange(itemId, 'quotationExpirySelections', selections);
                  }} className={`${getQuotationFormInputClass(errors.quotationExpirySelections)} h-8 w-24`} />
                </label> : <span className="text-[10px] font-medium text-slate-500">{unavailableReason}</span>}
              </div>;
            })}
            <div ref={(element) => registerFieldRef(`${itemFieldPrefix}.quotationExpirySelections`, element)} tabIndex={-1} className="outline-none">
              <FieldError id={fieldId('quotationExpirySelections')} message={errors.quotationExpirySelections} />
            </div>
            <p className="text-[10px] text-slate-500">Any quantity not matched to a selected batch will be shown as expiry to be confirmed.</p>
          </div>}
        </div>}
        {item.itemType === 'inventory' && item.sku && Number(item.sellingPrice) !== Number(item.originalUnitPrice) && <label className="sm:col-span-2 md:col-span-6"><span className={QUOTATION_FIELD_LABEL_CLASS}>Price adjustment reason <span className="text-rose-700">*</span></span><input {...inputProps('priceOverrideReason')} value={item.priceOverrideReason || ''} readOnly={!['admin', 'superadmin'].includes(userRole)} onChange={(event) => onChange(itemId, 'priceOverrideReason', event.target.value)} className={getQuotationFormInputClass(errors.priceOverrideReason)} placeholder="Reason for quoted price" /><FieldError id={fieldId('priceOverrideReason')} message={errors.priceOverrideReason} /></label>}
        <label className="md:col-span-4">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Expected Date (Optional)</span>
          <input {...inputProps('expectedArrivalDate')} type="date" min={getTodayInputDate()} value={item.expectedArrivalDate} onChange={(event) => onChange(itemId, 'expectedArrivalDate', event.target.value)} className={getQuotationFormInputClass(errors.expectedArrivalDate)} />
          <FieldError id={fieldId('expectedArrivalDate')} message={errors.expectedArrivalDate} />
        </label>
        <label className="sm:col-span-2 md:col-span-8">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Description</span>
          <input value={item.description} onChange={(event) => onChange(itemId, 'description', event.target.value)} onBlur={(event) => onChange(itemId, 'description', normalizeHumanReadable(event.target.value))} className={QUOTATION_FORM_INPUT_CLASS} placeholder="Item description" />
        </label>
        <label className="sm:col-span-2 md:col-span-12">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Item Notes (Optional)</span>
          <input value={item.remarks} onChange={(event) => onChange(itemId, 'remarks', event.target.value)} className={QUOTATION_FORM_INPUT_CLASS} placeholder="Optional item notes" />
        </label>
        <div className="sm:col-span-2 md:col-span-12">
          <span className={QUOTATION_FIELD_LABEL_CLASS}>Product Images <span className="font-normal text-slate-500">(Optional · 1–3 photos, JPG/PNG/WebP, up to 5 MB each)</span></span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(item.photos || []).map((photo, photoIndex) => <div key={`${item.itemId}-${photoIndex}`} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
              <LocalItemPhoto photo={photo} />
              <div className="flex flex-col gap-0.5 text-[10px]">
                <span className="max-w-20 truncate text-slate-600" title={photo.name}>{photoIndex === 0 ? 'Primary' : photo.name}</span>
                <div className="flex gap-1">
                  {photoIndex > 0 && <button type="button" disabled={disabled} onClick={() => { const photos = [...item.photos]; [photos[photoIndex - 1], photos[photoIndex]] = [photos[photoIndex], photos[photoIndex - 1]]; onChange(itemId, 'photos', photos); }} className="text-slate-700 underline focus-visible:outline focus-visible:outline-2" aria-label={`Move photo ${photoIndex + 1} earlier`}>Earlier</button>}
                  <button type="button" disabled={disabled} onClick={() => onChange(itemId, 'photos', item.photos.filter((_, current) => current !== photoIndex))} className="text-rose-600 underline focus-visible:outline focus-visible:outline-2" aria-label={`Remove photo ${photoIndex + 1}`}>Remove</button>
                </div>
                <label className="cursor-pointer text-slate-700 underline focus-within:outline focus-within:outline-2">Replace<input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => { const replacement = event.target.files?.[0]; if (replacement) onChange(itemId, 'photos', item.photos.map((photo, current) => current === photoIndex ? replacement : photo)); event.target.value = ''; }} /></label>
              </div>
            </div>)}
            {(item.photos || []).length < 3 && <ProductPhotoUploadArea disabled={disabled} inputProps={inputProps('photos')} onFilesSelected={(files) => onChange(itemId, 'photos', [...(item.photos || []), ...files])} />}
          </div>
          <FieldError id={fieldId('photos')} message={errors.photos} />
        </div>
      </div>
    </div>
  );
};

const SpecialOrders = () => {
  const navigate = useNavigate();
  const { logActivity, setTransactions, inventory, categories = [], ensureInventoryImages } = useInventory();
  const { appSettings, currentUserName, userRole, currentAuthUserId } = useAuth();
  const [orders, setOrders] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [ordersLoadError, setOrdersLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [rowWorkflowData, setRowWorkflowData] = useState({});
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [postSaleFlow, setPostSaleFlow] = useState(null);
  const [quotation, setQuotation] = useState(null);
  const [quotationHistory, setQuotationHistory] = useState([]);
  const [quotationEditorOpen, setQuotationEditorOpen] = useState(false);
  const [quotationDraft, setQuotationDraft] = useState(null);
  const [quotationError, setQuotationError] = useState('');
  const [quotationLoading, setQuotationLoading] = useState(false);
  const [stockAvailability, setStockAvailability] = useState(null);
  const [stockError, setStockError] = useState('');
  const [stockLoading, setStockLoading] = useState(false);
  const [paymentLedger, setPaymentLedger] = useState(null);
  const [paymentError, setPaymentError] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', downPaymentPercentage: '50', paymentPlan: 'cash', termDays: '30', method: 'cash', otherMethod: '', reference: '', notes: '', chequeCleared: false, invoiceNumber: '', saleDocuments: [], proofs: [] });
  const completionActionRef = useRef(null);
  const [paymentProofPreview, setPaymentProofPreview] = useState(null);
  const paymentProofCloseRef = useRef(null);
  const paymentProofTriggerRef = useRef(null);
  const paymentRequestRef = useRef('');
  const paymentDraftOrderRef = useRef('');
  const paymentInFlightRef = useRef(false);
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  const [cancelOrderReason, setCancelOrderReason] = useState('');
  const stockActionRequestRef = useRef(null);
  const [detailLoading, setDetailLoading] = useState(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [completionConfirmOpen, setCompletionConfirmOpen] = useState(false);
  const completionConfirmCancelRef = useRef(null);
  const completionConfirmTriggerRef = useRef(null);
  const completionConfirmFocusedRef = useRef(false);
  const [quotationPreview, setQuotationPreview] = useState(null);
  const [completedTransactionPreview, setCompletedTransactionPreview] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [itemRemovalTargetId, setItemRemovalTargetId] = useState(null);
  const itemRemovalCancelRef = useRef(null);
  const itemRemovalTriggerRef = useRef(null);
  const addItemButtonRef = useRef(null);
  const formScrollContainerRef = useRef(null);
  const [declineReason, setDeclineReason] = useState('');
  const [supportingImage, setSupportingImage] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState('');
  const imageRequestRef = useRef(0);
  const [form, setForm] = useState(createEmptyForm);
  const loadingProductImages = form.items.some((item) => item.productImageRequest);
  const initialFormSnapshotRef = useRef('');
  const formDraftRef = useRef(form);
  formDraftRef.current = form;
  const [formErrors, setFormErrors] = useState({});
  const [expiryBatchInfoByItemId, setExpiryBatchInfoByItemId] = useState({});
  const expiryBatchRequestSequenceRef = useRef(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [supplierPartners, setSupplierPartners] = useState([]);
  const [customerPartners, setCustomerPartners] = useState([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [quickAddCustomerOpen, setQuickAddCustomerOpen] = useState(false);
  const [quickAddCustomerName, setQuickAddCustomerName] = useState('');
  const [quickAddCustomerError, setQuickAddCustomerError] = useState('');
  const [savingCustomer, setSavingCustomer] = useState(false);
  const customerCreateInFlightRef = useRef(false);
  const customerCreateRequestIdRef = useRef('');
  const quotationGateRef = useRef(createQuotationRequestGate());
  const detailTicketRef = useRef(null);
  const detailLoadRef = useRef(null);
  const quotationActionRef = useRef(false);
  const [isSuppliersLoading, setIsSuppliersLoading] = useState(false);
  const [orderAction, setOrderAction] = useState('');
  const closeCompletionConfirmation = useCallback(() => {
    if (orderAction) return;
    setCompletionConfirmOpen(false);
    const trigger = completionConfirmTriggerRef.current;
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
      completionConfirmTriggerRef.current = null;
    });
  }, [orderAction]);
  const loadRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const hasLoadedOnceRef = useRef(false);
  const inFlightLoadRef = useRef(null);
  const repeatOrdersLoadRef = useRef(false);
  const supplierPartnersRequestRef = useRef(0);
  const detailRefreshSequenceRef = useRef(0);
  const rowWorkflowRequestRef = useRef(0);
  const [detailRefreshNonce, setDetailRefreshNonce] = useState(0);
  const submitInFlightRef = useRef(false);
  const specialOrderCreateRequestIdRef = useRef('');
  const formFieldRefs = useRef({});

  const loadOrders = useCallback(async () => {
    const requestKey = `${statusFilter}\u0000${searchTerm}`;
    if (inFlightLoadRef.current?.key === requestKey) {
      repeatOrdersLoadRef.current = true;
      return inFlightLoadRef.current.promise;
    }

    const requestId = ++loadRequestIdRef.current;
    setOrdersLoadError('');
    if (!hasLoadedOnceRef.current) setInitialLoading(true);
    else setRefreshing(true);

    const requestPromise = listSpecialOrdersApi({ status: statusFilter, search: searchTerm });
    inFlightLoadRef.current = { key: requestKey, promise: requestPromise };

    try {
      const rows = await requestPromise;
      if (isMountedRef.current && requestId === loadRequestIdRef.current) {
        setOrders(Array.isArray(rows) ? rows : []);
        setOrdersLoadError('');
      }
    } catch (error) {
      if (isMountedRef.current && requestId === loadRequestIdRef.current) {
        setOrdersLoadError(error?.message || 'Unable to load Special Orders. Please try again.');
        showPageLoadError(showToast, error, 'special-orders-load');
      }
    } finally {
      if (inFlightLoadRef.current?.promise === requestPromise) inFlightLoadRef.current = null;
      if (isMountedRef.current && requestId === loadRequestIdRef.current) {
        hasLoadedOnceRef.current = true;
        setInitialLoading(false);
        setRefreshing(false);
      }
      if (repeatOrdersLoadRef.current && isMountedRef.current) {
        repeatOrdersLoadRef.current = false;
        window.setTimeout(() => { if (isMountedRef.current) void loadOrders(); }, 0);
      }
    }
  }, [searchTerm, statusFilter]);

  useEffect(() => {
    isMountedRef.current = true;
    const gate = quotationGateRef.current;
    return () => {
      isMountedRef.current = false;
      gate.invalidate();
    };
  }, []);

  useEffect(() => {
    if (!paymentProofPreview) return undefined;
    paymentProofCloseRef.current?.focus();
    const onKeyDown = (event) => { if (event.key === 'Escape') { event.preventDefault(); setPaymentProofPreview(null); } };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); requestAnimationFrame(() => document.getElementById(paymentProofTriggerRef.current)?.focus()); URL.revokeObjectURL(paymentProofPreview.url); };
  }, [paymentProofPreview]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    let refreshTimer = null;
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadOrders();
        if (selectedOrder?._id) setDetailRefreshNonce((value) => value + 1);
      }, 80);
    };
    const events = ['special-order.updated', 'credit-transactions.updated', 'inventory.updated', 'realtime.resync'];
    const unsubscribe = events.map((event) => subscribeRealtimeEvent(event, scheduleRefresh));
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      unsubscribe.forEach((stop) => stop());
    };
  }, [loadOrders, selectedOrder?._id]);

  useEffect(() => {
    const orderId = String(selectedOrder?._id || '');
    if (!detailRefreshNonce || !orderId || showForm || quotationEditorOpen || quotationPreview || decisionOpen
      || paymentOpen || paymentProofPreview || completionConfirmOpen || orderAction || quotationLoading) return undefined;

    let active = true;
    const requestId = ++detailRefreshSequenceRef.current;
    const workflowV2 = Number(selectedOrder.workflowVersion) >= 2;
    Promise.allSettled([
      listSpecialOrdersApi({ status: 'All', search: selectedOrder.orderNumber || '' }),
      listSpecialOrderQuotationsApi(orderId),
      workflowV2 ? getSpecialOrderStockAvailabilityApi(orderId) : Promise.resolve(null),
      workflowV2 ? getSpecialOrderPaymentsApi(orderId) : Promise.resolve({ ledger: null }),
    ]).then(([ordersResult, quotationsResult, availabilityResult, paymentResult]) => {
      if (!active || requestId !== detailRefreshSequenceRef.current) return;
      const latestOrder = ordersResult.status === 'fulfilled'
        ? (ordersResult.value || []).find((row) => String(row?._id) === orderId)
        : null;
      const quotations = quotationsResult.status === 'fulfilled' && Array.isArray(quotationsResult.value)
        ? quotationsResult.value : null;
      const currentQuotation = quotations?.find((row) => row.isCurrent) || null;
      setSelectedOrder((previous) => previous && String(previous._id) === orderId
        ? { ...(latestOrder || previous), ...(quotations ? { quotation: currentQuotation } : {}) }
        : previous);
      if (quotations) {
        setQuotationHistory(quotations);
        setQuotation(currentQuotation);
      }
      if (availabilityResult.status === 'fulfilled' && workflowV2) setStockAvailability(availabilityResult.value);
      if (paymentResult.status === 'fulfilled' && workflowV2) setPaymentLedger(paymentResult.value?.ledger || null);
    }).finally(() => {
      if (active && requestId === detailRefreshSequenceRef.current) setDetailRefreshNonce(0);
    });
    return () => {
      active = false;
      detailRefreshSequenceRef.current += 1;
    };
  }, [detailRefreshNonce, selectedOrder?._id, selectedOrder?.workflowVersion, selectedOrder?.orderNumber, showForm, quotationEditorOpen, quotationPreview, decisionOpen, paymentOpen, paymentProofPreview, completionConfirmOpen, orderAction, quotationLoading]);

  useEffect(() => {
    if (!completionConfirmOpen) {
      completionConfirmFocusedRef.current = false;
      return undefined;
    }
    if (!orderAction && !completionConfirmFocusedRef.current) {
      completionConfirmCancelRef.current?.focus();
      completionConfirmFocusedRef.current = true;
    }
  }, [completionConfirmOpen, orderAction]);

  const isAnyModalOpen = Boolean(
    showForm ||
    selectedOrder ||
    paymentOpen ||
    paymentProofPreview ||
    completionConfirmOpen ||
    cancelOrderOpen ||
    decisionOpen ||
    quotationEditorOpen ||
    quotationPreview ||
    completedTransactionPreview ||
    supportingImage ||
    postSaleFlow
  );

  useEffect(() => {
    if (!isAnyModalOpen) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.classList.add('overflow-hidden');
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.classList.remove('overflow-hidden');
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [isAnyModalOpen]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter]);

  const formSummary = useMemo(() => {
    const result = (form.items || []).reduce((summary, item) => {
      const quantity = Number(item.quantity || 0);
      const unitCents = parseMoneyToCentavos(String(item.sellingPrice || '0'));
      const lineCents = quantity * (unitCents ?? 0);
      return {
        itemCount: summary.itemCount + 1,
        quantity: summary.quantity + quantity,
        cents: Number.isSafeInteger(lineCents) && Number.isSafeInteger(summary.cents + lineCents) ? summary.cents + lineCents : 0,
      };
    }, { itemCount: 0, quantity: 0, cents: 0 });
    return { itemCount: result.itemCount, quantity: result.quantity, total: result.cents / 100 };
  }, [form.items]);

  const selectedSummary = useMemo(() => selectedOrder ? summarizeOrder(selectedOrder) : null, [selectedOrder]);
  const customOnlyQuotation = Number(selectedOrder?.workflowVersion) >= 2 && quotation?.status === 'Accepted'
    && Array.isArray(quotation.items) && quotation.items.length > 0
    && quotation.items.every((item) => item.itemType === 'custom' && !item.inventoryProduct && !item.inventorySnapshot);
  const finalCustomPayment = customOnlyQuotation && paymentLedger?.remainingBalanceCentavos > 0
    && parseMoneyToCentavos(paymentForm.amount) === paymentLedger.remainingBalanceCentavos;
  const paymentSummaryDownPaymentCentavos = paymentLedger
    ? paymentLedger.payments?.find((payment) => payment.type === 'down_payment')?.amountCentavos
      ?? (paymentLedger.approvedTotalCentavos - paymentLedger.remainingBalanceCentavos)
    : parseMoneyToCentavos(paymentForm.amount);
  const paymentSummaryRemainingCentavos = paymentLedger
    ? paymentLedger.remainingBalanceCentavos
    : getSpecialOrderRemainingBalanceCentavos(quotation?.total, paymentForm.downPaymentPercentage);
  const inventoryPreparationItems = useMemo(() => (stockAvailability?.items || []).filter((item) => item.itemType === 'inventory'), [stockAvailability]);
  const showStockRefresh = hasInventoryLinkedItems(stockAvailability?.items ?? selectedSummary?.items);
  const quotationActions = quotationCapabilities(selectedOrder, quotation, userRole, currentAuthUserId);
  const approvedTaxTreatment = approvedSpecialOrderTaxTreatment(selectedOrder, quotation);
  const canProcessSpecialOrder = ['cashier', 'admin', 'superadmin'].includes(userRole);
  const canManageOrderExceptions = userRole === 'admin' || userRole === 'superadmin';
  const hasDetailsFooterActions = selectedOrder?.status === 'Completed'
    || Boolean(selectedOrder?.linkedSaleId)
    || Boolean(quotationActions.edit)
    || Boolean(quotation && quotation.status !== 'Draft')
    || Boolean(quotationActions.revise)
    || (canManageOrderExceptions && Number(selectedOrder?.workflowVersion) >= 2 && selectedOrder?.status === 'In Progress' && !paymentLedger && !paymentError);
  const phaseFiveCompletionReady = Number(selectedOrder?.workflowVersion) >= 2
    && canProcessSpecialOrder && selectedOrder?.status === 'In Progress'
    && quotation?.status === 'Accepted' && quotation?.isCurrent
    && String(selectedOrder?.transactionQuotation || '') === String(quotation?._id || '')
    && Boolean(approvedTaxTreatment)
    && paymentLedger?.remainingBalanceCentavos === 0 && paymentLedger?.status === 'Fully Paid'
    && !stockError && !paymentError;
  const quotationBusy = Boolean(orderAction) || quotationLoading;
  const isOrderListLoading = initialLoading || (refreshing && orders.length === 0);
  const hasOrderListFilters = Boolean(searchTerm.trim()) || statusFilter !== 'All';
  const orderEmptyState = ordersLoadError
    ? { title: 'Special Orders unavailable', description: 'Orders could not be loaded. Please try again.', actionLabel: 'Retry', onAction: () => { void loadOrders(); } }
    : hasOrderListFilters
      ? { title: 'No matching results', description: 'Try a different search or filter.', actionLabel: 'Clear Filters', onAction: () => { setSearchTerm(''); setStatusFilter('All'); } }
      : { title: 'No special orders yet', description: 'Create your first quotation to get started.', actionLabel: 'Create Quotation', onAction: () => openCreateForm(),
        actionIcon: <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg> };
  const totalPages = Math.ceil(orders.length / itemsPerPage);
  const activePage = Math.min(currentPage, Math.max(totalPages, 1));
  const indexOfFirstOrder = (activePage - 1) * itemsPerPage;
  const paginatedOrders = useMemo(() => orders.slice(indexOfFirstOrder, indexOfFirstOrder + itemsPerPage), [orders, indexOfFirstOrder, itemsPerPage]);
  const displayStart = orders.length === 0 ? 0 : indexOfFirstOrder + 1;
  const displayEnd = Math.min(indexOfFirstOrder + itemsPerPage, orders.length);

  useEffect(() => {
    const eligibleRows = paginatedOrders.filter((order) => Number(order.workflowVersion) >= 2
      && order.status === 'In Progress'
      && quotationCapabilities(order, order.quotation, userRole, currentAuthUserId).allowed
      && ['cashier', 'admin', 'superadmin'].includes(userRole));
    const requestId = ++rowWorkflowRequestRef.current;
    if (eligibleRows.length === 0) {
      setRowWorkflowData({});
      return undefined;
    }

    setRowWorkflowData(Object.fromEntries(eligibleRows.map((order) => [String(order._id), { paymentLoading: true }])));
    let active = true;
    Promise.all(eligibleRows.map(async (order) => {
      const [quotationResult, paymentResult] = await Promise.allSettled([
        listSpecialOrderQuotationsApi(order._id),
        getSpecialOrderPaymentsApi(order._id),
      ]);
      const quotationRows = quotationResult.status === 'fulfilled' && Array.isArray(quotationResult.value)
        ? quotationResult.value
        : [];
      const currentRows = quotationRows.filter((quotation) => quotation?.isCurrent === true);
      const currentQuotation = currentRows.length === 1
        && (!order.currentQuotation || String(order.currentQuotation) === String(currentRows[0]._id))
        ? currentRows[0]
        : null;
      const quotationError = quotationResult.status === 'rejected'
        ? 'Quotation status could not be checked. Open View Details to retry.'
        : currentRows.length > 1 || (currentRows.length === 1 && !currentQuotation)
          ? 'Quotation history needs review. Open View Details to retry.'
          : '';
      const paymentLedger = paymentResult.status === 'fulfilled' ? paymentResult.value?.ledger || null : null;
      if (paymentResult.status === 'rejected') {
        return [String(order._id), { quotation: currentQuotation, quotationError, paymentError: paymentResult.reason?.message || 'Payment status could not be checked.' }];
      }
      if (quotationResult.status === 'rejected') {
        return [String(order._id), { quotation: currentQuotation, quotationError, paymentLedger }];
      }
      const paymentComplete = paymentLedger?.status === 'Fully Paid' && paymentLedger?.remainingBalanceCentavos === 0;
      if (!paymentComplete) return [String(order._id), { quotation: currentQuotation, quotationError, paymentLedger }];
      try {
        const stockAvailability = await getSpecialOrderStockAvailabilityApi(order._id);
        return [String(order._id), { quotation: currentQuotation, quotationError, paymentLedger, stockAvailability }];
      } catch (error) {
        return [String(order._id), { quotation: currentQuotation, quotationError, paymentLedger, stockError: error?.message || 'Stock availability could not be checked.' }];
      }
    })).then((entries) => {
      if (active && requestId === rowWorkflowRequestRef.current) setRowWorkflowData(Object.fromEntries(entries));
    });

    return () => { active = false; };
  }, [paginatedOrders, userRole, currentAuthUserId]);

  useEffect(() => {
    setCurrentPage((previous) => Math.min(previous, Math.max(totalPages, 1)));
  }, [totalPages]);

  const loadSupplierPartners = useCallback(async ({ notifyInvalidSelection = false } = {}) => {
    const requestId = ++supplierPartnersRequestRef.current;
    setIsSuppliersLoading(true);
    try {
      const [rows, customers] = await Promise.all([listPartnersApi({ type: 'supplier', includeArchived: false }), listPartnersApi({ type: 'customer', includeArchived: false })]);
      if (!isMountedRef.current || requestId !== supplierPartnersRequestRef.current) return;
      const activeSuppliers = (Array.isArray(rows) ? rows : [])
        .filter((partner) => partner?.type === 'supplier' && !partner?.isArchived)
        .sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || '')));
      const activeCustomers = (Array.isArray(customers) ? customers : []).filter((customer) => customer.type === 'customer' && !customer.isArchived && (customer.customerType || 'regular') === 'regular');
      setSupplierPartners(activeSuppliers);
      setCustomerPartners(activeCustomers);
      if (notifyInvalidSelection) {
        const draft = formDraftRef.current;
        const selectedCustomer = String(draft.customerId || '');
        const selectedSuppliers = (draft.items || []).map((item) => String(item.supplierId || '')).filter(Boolean);
        const customerInvalid = selectedCustomer && !activeCustomers.some((customer) => String(customer._id || customer.id) === selectedCustomer);
        const supplierInvalid = selectedSuppliers.some((supplierId) => !activeSuppliers.some((supplier) => String(supplier._id || supplier.id) === supplierId));
        if (customerInvalid || supplierInvalid) {
          showToast('Partner Needs Recheck', 'A selected customer or supplier is no longer active. Review this form before saving.', 'warning', 'special-order-partner-inactive');
        }
      }
    } catch (error) {
      if (isMountedRef.current && requestId === supplierPartnersRequestRef.current) {
        showToast('Supplier Load Failed', error.message || 'Unable to load supplier partners.', 'error', 'special-order-suppliers-load');
      }
    } finally {
      if (isMountedRef.current && requestId === supplierPartnersRequestRef.current) setIsSuppliersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showForm) return undefined;
    let refreshTimer = null;
    const schedulePartnersRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadSupplierPartners({ notifyInvalidSelection: true });
      }, 80);
    };
    const unsubscribePartners = subscribeRealtimeEvent('partners.updated', schedulePartnersRefresh);
    const unsubscribeResync = subscribeRealtimeEvent('realtime.resync', schedulePartnersRefresh);
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      unsubscribePartners();
      unsubscribeResync();
      supplierPartnersRequestRef.current += 1;
    };
  }, [loadSupplierPartners, showForm]);

  const invalidateExpiryBatchInfo = (itemId) => {
    const id = String(itemId || '');
    expiryBatchRequestSequenceRef.current.set(id, (expiryBatchRequestSequenceRef.current.get(id) || 0) + 1);
    setExpiryBatchInfoByItemId((previous) => {
      if (!previous[id]) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const loadExpiryBatchInfo = async (itemId, productId) => {
    const id = String(itemId || '');
    const productKey = String(productId || '');
    if (!id || !productKey) return;
    const requestId = (expiryBatchRequestSequenceRef.current.get(id) || 0) + 1;
    expiryBatchRequestSequenceRef.current.set(id, requestId);
    setExpiryBatchInfoByItemId((previous) => ({ ...previous, [id]: { loading: true, error: '', data: null } }));
    try {
      const response = await listProductExpiryBatchesApi(productKey, 1);
      if (expiryBatchRequestSequenceRef.current.get(id) !== requestId) return;
      const currentItem = (formDraftRef.current.items || []).find((entry) => String(entry.itemId || entry.__rowId) === id);
      if (!currentItem || String(currentItem.inventoryProduct || '') !== productKey || currentItem.itemType !== 'inventory') return;
      const data = response?.reconciled !== undefined ? response : response?.data;
      if (!data || typeof data !== 'object') throw new Error('Batch details were unavailable.');
      setExpiryBatchInfoByItemId((previous) => ({ ...previous, [id]: { loading: false, error: '', data } }));
    } catch (error) {
      if (expiryBatchRequestSequenceRef.current.get(id) !== requestId) return;
      setExpiryBatchInfoByItemId((previous) => ({ ...previous, [id]: { loading: false, error: error?.message || 'Batch details could not be loaded.', data: null } }));
    }
  };

  const openCreateForm = () => {
    quotationGateRef.current.invalidate();
    detailLoadRef.current = null;
    setDetailLoading(null);
    setQuotationLoading(false);
    setSelectedOrder(null);
    specialOrderCreateRequestIdRef.current = '';
    const nextForm = { ...createEmptyForm(), quotationDetails: { attentionName: '', attentionPosition: '', authorizedSignatoryName: DEFAULT_QUOTATION_SIGNATORY } };
    initialFormSnapshotRef.current = quotationFormSnapshot(nextForm, '');
    setForm(nextForm);
    setExpiryBatchInfoByItemId({});
    setFormErrors({});
    setCustomerQuery('');
    setQuickAddCustomerOpen(false);
    setDiscardConfirmOpen(false);
    customerCreateRequestIdRef.current = '';
    setShowForm(true);
    void loadSupplierPartners();
  };

  const closeForm = ({ force = false } = {}) => {
    if (isSubmitting && !force) return;
    if (!force && quotationFormSnapshot(formDraftRef.current, customerQuery) !== initialFormSnapshotRef.current) {
      setDiscardConfirmOpen(true);
      return;
    }
    setDiscardConfirmOpen(false);
    setShowForm(false);
    for (const item of formDraftRef.current.items || []) invalidateExpiryBatchInfo(item.itemId || item.__rowId);
    setExpiryBatchInfoByItemId({});
    setForm(createEmptyForm());
    initialFormSnapshotRef.current = '';
    setFormErrors({});
    setCustomerQuery('');
    setQuickAddCustomerOpen(false);
  };

  const discardQuotationChanges = () => closeForm({ force: true });

  const selectCustomer = (customer) => {
    const id = String(customer?._id || customer?.id || '');
    const customerTaxTreatment = customer?.taxTreatment || (customer?.isVatExempt ? 'exempt' : 'standard');
    setForm((previous) => ({ ...previous, customerId: id, customerName: customer?.name || '', customerVatExempt: customerTaxTreatment === 'exempt', taxTreatment: ['standard', 'vat_zero_rated'].includes(customerTaxTreatment) ? customerTaxTreatment : '', quotationDetails: customer ? { ...previous.quotationDetails, attentionName: customer.attentionName || '', attentionPosition: customer.attentionPosition || '' } : previous.quotationDetails }));
    setFormErrors((previous) => ({ ...previous, customerName: '' }));
    if (customer) setCustomerQuery(customer.name || '');
  };

  const closeQuickAddCustomer = () => {
    setQuickAddCustomerOpen(false);
    setQuickAddCustomerError('');
    customerCreateRequestIdRef.current = '';
    window.requestAnimationFrame(() => formFieldRefs.current.customerName?.focus());
  };

  const saveQuickAddCustomer = async (event) => {
    event.preventDefault();
    if (customerCreateInFlightRef.current) return;
    const name = normalizeHumanReadable(quickAddCustomerName.replace(/\s+/g, ' '));
    if (!name) { setQuickAddCustomerError('Customer Name is required.'); return; }
    customerCreateInFlightRef.current = true;
    setSavingCustomer(true);
    setQuickAddCustomerError('');
    try {
      const latest = await listPartnersApi({ type: 'customer', includeArchived: false });
      const active = (Array.isArray(latest) ? latest : []).filter((row) => row.type === 'customer' && !row.isArchived && (row.customerType || 'regular') === 'regular');
      const existing = active.find((row) => customerNameKey(row.name) === customerNameKey(name));
      if (existing) {
        setCustomerPartners(active);
        selectCustomer(existing);
        closeQuickAddCustomer();
        showToast('Customer Selected', 'An existing regular customer with this name was selected.', 'success', 'special-order-existing-customer');
        return;
      }
      const created = await createPartnerApi({ type: 'customer', name, clientRequestId: customerCreateRequestIdRef.current || (customerCreateRequestIdRef.current = createClientRequestId('partner')) });
      setCustomerPartners((previous) => [...previous.filter((row) => String(row._id || row.id) !== String(created._id || created.id)), created]);
      selectCustomer(created);
      closeQuickAddCustomer();
      showToast('Customer Added', `${created.name} is selected for this quotation.`, 'success', 'special-order-customer-created');
    } catch (error) {
      setQuickAddCustomerError(error?.message || 'Unable to save the customer. Retry.');
    } finally {
      customerCreateInFlightRef.current = false;
      setSavingCustomer(false);
    }
  };

  const openOrderDetails = async (order, { action = '', fromConfirmation = false } = {}) => {
    if (quotationActionRef.current) return;
    if (detailLoadRef.current?.orderId === String(order._id)) return;
    const isTablePaymentAction = action === 'payment';
    const isTableCompletionAction = action === 'complete-order';
    const isTableWorkflowAction = isTablePaymentAction || isTableCompletionAction;
    setCompletionConfirmOpen(false);
    completionConfirmTriggerRef.current = null;
    if (paymentDraftOrderRef.current !== String(order._id)) {
      paymentDraftOrderRef.current = String(order._id);
      paymentRequestRef.current = '';
      setPaymentForm({ amount: '', downPaymentPercentage: '50', paymentPlan: 'cash', termDays: '30', method: 'cash', otherMethod: '', reference: '', notes: '', chequeCleared: false, invoiceNumber: '', saleDocuments: [], proofs: [] });
      completionActionRef.current = null;
    }
    const ticket = quotationGateRef.current.begin(order._id);
    detailLoadRef.current = { orderId: String(order._id), ticket };
    detailTicketRef.current = ticket;
    setSelectedOrder(null);
    setDetailLoading({ orderId: String(order._id), orderNumber: order.orderNumber, action: action || 'details' });
    setQuotation(null);
    setQuotationHistory([]);
    setQuotationDraft(null);
    setQuotationEditorOpen(false);
    setQuotationPreview(null);
    setQuotationError('');
    setStockAvailability(null);
    setStockError('');
    setStockLoading(Number(order.workflowVersion) >= 2);
    setPaymentLedger(null);
    setPaymentError('');
    setPaymentOpen(false);
    setCancelOrderOpen(false);
    setCancelOrderReason('');
    setDecisionOpen(false);
    setDeclineReason('');
    setQuotationLoading(true);
    try {
      let authoritativeOrder = order;
      if (isTableWorkflowAction) {
        const latestOrders = await listSpecialOrdersApi({ status: 'All', search: order.orderNumber || '' });
        if (!isMountedRef.current || !quotationGateRef.current.isCurrent(ticket)) return;
        authoritativeOrder = (latestOrders || []).find((row) => String(row?._id) === String(order._id));
        if (!authoritativeOrder) throw new Error('This order is no longer available. Refresh the table and try again.');
      }
      const workflowV2 = Number(authoritativeOrder.workflowVersion) >= 2;
      const [quotationResult, availabilityResult, paymentResult] = await Promise.allSettled([
        listSpecialOrderQuotationsApi(order._id),
        workflowV2 ? getSpecialOrderStockAvailabilityApi(order._id) : Promise.resolve(null),
        workflowV2 ? getSpecialOrderPaymentsApi(order._id) : Promise.resolve({ ledger: null }),
      ]);
      if (!isMountedRef.current || !quotationGateRef.current.isCurrent(ticket)) return;
      if (quotationResult.status === 'rejected') throw quotationResult.reason;
      if (isTableWorkflowAction && availabilityResult.status === 'rejected') throw availabilityResult.reason;
      if (isTableWorkflowAction && paymentResult.status === 'rejected') throw paymentResult.reason;
      const quotations = quotationResult.value;
      if (availabilityResult.status === 'fulfilled') setStockAvailability(availabilityResult.value);
      else setStockError(availabilityResult.reason?.message || 'Availability could not be loaded. Refresh to retry.');
      if (paymentResult.status === 'fulfilled') setPaymentLedger(paymentResult.value?.ledger || null);
      else setPaymentError(paymentResult.reason?.message || 'Payment history could not be loaded. Reload before recording payment.');
      const rows = Array.isArray(quotations) ? quotations : [];
      setQuotationHistory(rows);
      if (rows.filter((row) => row.isCurrent).length > 1) throw new Error('Quotation history has conflicting current versions. Request administrative review.');
      const current = rows.find((row) => row.isCurrent) || null;
      if (!isMountedRef.current || !quotationGateRef.current.isCurrent(ticket)) return;
      const loadedOrder = current ? { ...authoritativeOrder, quotation: current } : authoritativeOrder;
      if (action === 'decide' && !quotationCapabilities(loadedOrder, current, userRole, currentAuthUserId).decide) {
        throw new Error('This quotation is no longer awaiting a customer decision. Reload the table.');
      }
      if (isTableWorkflowAction) {
        setOrders((previous) => previous.map((row) => String(row._id) === String(loadedOrder._id) ? { ...row, ...loadedOrder } : row));
        const latestAction = getPhaseFiveTableNextAction({
          order: loadedOrder,
          quotation: current,
          paymentLedger: paymentResult.value?.ledger || null,
          paymentError: paymentResult.status === 'rejected' ? paymentResult.reason?.message || 'Payment history could not be loaded.' : '',
          stockAvailability: availabilityResult.value,
          stockError: availabilityResult.status === 'rejected' ? availabilityResult.reason?.message || 'Stock availability could not be loaded.' : '',
          role: userRole,
          userId: currentAuthUserId,
        });
        const requiredAction = isTablePaymentAction ? 'record-payment' : 'complete-order';
        if (latestAction?.type !== requiredAction) {
          if (isTableCompletionAction && latestAction?.type === 'complete-blocked') {
            setSelectedOrder(loadedOrder);
            setQuotation(current);
            showToast('Order Not Ready', latestAction.reason, 'warning', 'special-order-completion-not-ready');
            return;
          }
          const changedActionMessage = isTablePaymentAction && latestAction?.type === 'complete-order'
            ? 'This order is fully paid. Refresh the table to complete it.'
            : isTableCompletionAction && latestAction?.type === 'record-payment'
              ? 'Payment is incomplete. Refresh the table to record the remaining payment.'
              : isTablePaymentAction
                ? 'Payment status changed. Refresh the table before recording payment.'
                : 'Completion requirements changed. Refresh the table before continuing.';
          throw new Error(latestAction?.reason || changedActionMessage);
        }
      }
      const loadedLedger = paymentResult.value?.ledger || null;
      if (isTablePaymentAction && loadedLedger?.paymentPlan === 'credit') {
        if (!loadedLedger.creditTransactionId) throw new Error('The linked Credit Transaction is missing. Request administrative review.');
        navigate(`/credit-transactions?search=${encodeURIComponent(loadedLedger.creditTransactionId)}`);
        return;
      }
      if (isTablePaymentAction) {
        const paymentAmount = loadedLedger
          ? (Number(loadedLedger.remainingBalanceCentavos || 0) / 100).toFixed(2)
          : getSpecialOrderDownPaymentInput(current?.total);
        setPaymentForm((previous) => ({
          ...previous,
          amount: paymentAmount,
          downPaymentPercentage: loadedLedger?.downPaymentPercentage != null ? String(loadedLedger.downPaymentPercentage) : '50',
          paymentPlan: loadedLedger?.paymentPlan || previous.paymentPlan || 'cash',
        }));
      }
      setSelectedOrder(loadedOrder);
      setQuotation(current);
      if (action === 'decide') setDecisionOpen(true);
      if (isTablePaymentAction) setPaymentOpen(true);
      if (isTableCompletionAction) {
        completionConfirmTriggerRef.current = document.activeElement;
        setCompletionConfirmOpen(true);
      }
      if (fromConfirmation) setPostSaleFlow((previous) => previous?.order?._id === order._id ? { ...previous, phase: 'paused' } : previous);
    } catch (error) {
      if (!isMountedRef.current || !quotationGateRef.current.isCurrent(ticket)) return;
      if (isTableWorkflowAction) {
        setSelectedOrder(null);
        setPaymentOpen(false);
        void loadOrders();
        showToast('Order Updated', error?.message || 'Refresh the table and try again.', 'warning', 'special-order-table-action-stale');
      } else if (action !== 'decide') setSelectedOrder(order);
      if (fromConfirmation) setPostSaleFlow((previous) => previous?.order?._id === order._id ? { ...previous, phase: 'paused' } : previous);
      if (!isTableWorkflowAction) {
        setQuotationError(error?.message || 'Unable to load quotations. Retry before continuing.');
        showToast('Quotation Unavailable', error?.message || 'Unable to load quotation details.', 'error', 'special-order-quotation-load');
      }
    } finally {
      if (detailLoadRef.current?.ticket === ticket) detailLoadRef.current = null;
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) {
        setQuotationLoading(false);
        setStockLoading(false);
        setDetailLoading(null);
      }
    }
  };

  const registerQuotationFormField = useCallback((fieldKey, element) => {
    if (element) formFieldRefs.current[fieldKey] = element;
    else delete formFieldRefs.current[fieldKey];
  }, []);

  const validateItemRows = (items) => validateSpecialOrderItemRows(items, {
    userRole,
    isDateValid: isTodayOrLater,
    expiryBatchInfoByItemId,
  });

  const focusQuotationFormField = (fieldKey) => {
    if (!fieldKey || typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const itemId = String(fieldKey).match(/^items\.([^.]+)/)?.[1];
      const scroller = formScrollContainerRef.current;
      const registeredTarget = formFieldRefs.current[fieldKey]
        || (itemId ? formFieldRefs.current[`items.${itemId}`] : null);
      const fulfillmentError = fieldKey === 'fulfillment' && form.fulfillment.method === 'Free Delivery'
        ? validateLagunaDeliveryLocation(form.fulfillment)
        : '';
      const locationFieldId = /city|municipality/i.test(fulfillmentError)
        ? 'delivery-city-municipality'
        : /barangay/i.test(fulfillmentError) ? 'delivery-barangay' : '';
      const fulfillmentTarget = locationFieldId ? scroller?.querySelector(`#${locationFieldId}`) : null;
      const target = registeredTarget || fulfillmentTarget || Array.from(scroller?.querySelectorAll('[data-validation-key]') || [])
        .find((element) => element.dataset.validationKey === fieldKey);
      if (!target?.isConnected) return;

      if (scroller) {
        const targetRect = target.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const topLimit = scrollerRect.top + 16;
        const bottomLimit = scrollerRect.bottom - 16;
        let nextTop = scroller.scrollTop;
        if (targetRect.top < topLimit) nextTop += targetRect.top - topLimit;
        else if (targetRect.bottom > bottomLimit) nextTop += targetRect.bottom - bottomLimit;
        if (nextTop !== scroller.scrollTop) {
          const reduceMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
          scroller.scrollTo({ top: Math.max(0, nextTop), behavior: reduceMotion ? 'auto' : 'smooth' });
        }
      }
      if (typeof target.focus === 'function') target.focus({ preventScroll: true });
    });
  };

  const applyQuotationItemConsolidation = (result, { focusSurvivor = true } = {}) => {
    if (!result?.mergedGroups?.length) return false;
    result.mergedGroups.forEach((group) => group.removedItemIds.forEach(invalidateExpiryBatchInfo));
    setForm((previous) => ({ ...previous, items: result.items }));
    setFormErrors((previous) => {
      const items = { ...(previous.items || {}) };
      for (const group of result.mergedGroups) {
        delete items[group.survivorItemId];
        for (const removedId of group.removedItemIds) delete items[removedId];
      }
      return { ...previous, items };
    });
    const notice = result.mergedGroups.length === 1
      ? 'Quantity updated for existing item.'
      : 'Duplicate items were consolidated and quantities updated.';
    showToast('Items Consolidated', notice, 'success', 'special-order-quotation-items-consolidated');
    if (focusSurvivor) {
      const survivorId = result.mergedGroups[0].survivorItemId;
      focusQuotationFormField(`items.${survivorId}.itemName`);
    }
    return true;
  };

  const addItemRow = () => {
    const currentItems = formDraftRef.current.items || [];
    if (currentItems.some((item) => item.productImageRequest)) return;
    const currentItem = currentItems[currentItems.length - 1];
    if (!currentItem) {
      const newItem = createFormItem();
      setForm((previous) => ({ ...previous, items: [...(previous.items || []), newItem] }));
      focusQuotationFormField(`items.${newItem.itemId}.itemName`);
      return;
    }

    const validation = validateItemRows([currentItem]);
    if (validation.firstInvalidField) {
      const itemErrorKey = String(currentItem.itemId || currentItem.__rowId);
      setFormErrors((previous) => ({
        ...previous,
        items: { ...previous.items, [itemErrorKey]: validation.errors[itemErrorKey] || {} },
      }));
      focusQuotationFormField(validation.firstInvalidField);
      return;
    }

    const consolidation = consolidateQuotationItems(currentItems, { candidateItemId: currentItem.itemId });
    if (consolidation.error) {
      const { itemId, field, message } = consolidation.error;
      setFormErrors((previous) => ({
        ...previous,
        items: { ...previous.items, [itemId]: { ...previous.items?.[itemId], [field]: message } },
      }));
      showToast('Items Not Combined', message, 'warning', 'special-order-quotation-items-consolidation-error');
      focusQuotationFormField(`items.${itemId}.${field}`);
      return;
    }
    if (consolidation.mergedGroups.length) {
      const mergedValidation = validateItemRows(consolidation.items);
      if (mergedValidation.firstInvalidField) {
        setFormErrors((previous) => ({ ...previous, items: { ...previous.items, ...mergedValidation.errors } }));
        focusQuotationFormField(mergedValidation.firstInvalidField);
        return;
      }
    }
    if (applyQuotationItemConsolidation(consolidation)) return;

    const newItem = createFormItem();
    setForm((previous) => ({ ...previous, items: [...(previous.items || []), newItem] }));
    setFormErrors((previous) => ({
      ...previous,
      items: { ...previous.items, [currentItem.itemId]: {} },
    }));
    focusQuotationFormField(`items.${newItem.itemId}.itemName`);
  };

  const removeItemRowById = (targetId) => {
    if (!targetId) return;
    const targetItem = (formDraftRef.current.items || []).find((item) => (
      String(item.itemId) === String(targetId) || String(item.__rowId) === String(targetId)
    ));
    const errorKey = String(targetItem?.itemId || targetItem?.__rowId || targetId);
    invalidateExpiryBatchInfo(errorKey);
    setForm((previous) => {
      const currentItems = previous.items || [];
      const items = removeQuotationFormItemById(currentItems, targetId, createFormItem);
      if (items === currentItems) return previous;
      return { ...previous, items };
    });
    setFormErrors((previous) => {
      const items = { ...(previous.items || {}) };
      delete items[errorKey];
      return { ...previous, items };
    });
  };

  const requestRemoveItemRow = (itemId, trigger) => {
    if (!itemId || isSubmitting) return;
    itemRemovalTriggerRef.current = trigger || null;
    const targetId = String(itemId);
    const targetItem = (formDraftRef.current.items || []).find((item) => String(item.itemId) === targetId || String(item.__rowId) === targetId);
    if (!targetItem) return;
    if (!hasMeaningfulQuotationItemInput(targetItem)) {
      removeItemRowById(targetId);
      closeItemRemovalConfirmation();
      return;
    }
    setItemRemovalTargetId(String(itemId));
  };

  const closeItemRemovalConfirmation = useCallback(() => {
    setItemRemovalTargetId(null);
    const trigger = itemRemovalTriggerRef.current;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
      else addItemButtonRef.current?.focus();
    });
  }, []);

  const confirmRemoveItemRow = () => {
    const targetId = itemRemovalTargetId;
    if (!targetId || isSubmitting) return;
    removeItemRowById(targetId);
    closeItemRemovalConfirmation();
  };

  const updateItemRow = (itemId, field, value) => {
    const targetId = String(itemId);
    const currentItem = (formDraftRef.current.items || []).find((item) => String(item.itemId || item.__rowId) === targetId);
    const updatedItem = currentItem ? { ...currentItem, [field]: value } : null;
    setForm((previous) => ({
      ...previous,
      items: (previous.items || []).map((item) => String(item.itemId || item.__rowId) === targetId ? { ...item, [field]: value } : item),
    }));
    setFormErrors((previous) => {
      const rowErrors = previous.items?.[targetId];
      if (!rowErrors || Object.keys(rowErrors).length === 0 || !updatedItem) return previous;
      const items = { ...previous.items, [targetId]: validateItemRows([updatedItem]).errors[targetId] || {} };
      return { ...previous, items };
    });
  };

  const replaceItemRow = (itemId, value) => {
    const targetId = String(itemId);
    const existingItem = (formDraftRef.current.items || []).find((item) => String(item.itemId || item.__rowId) === targetId);
    const nextItem = { ...value, itemId: existingItem?.itemId || value.itemId, __rowId: existingItem?.__rowId || value.__rowId };
    invalidateExpiryBatchInfo(targetId);
    setForm((previous) => ({
      ...previous,
      items: previous.items.map((item) => String(item.itemId || item.__rowId) === targetId
        ? nextItem
        : item),
    }));
    setFormErrors((previous) => ({ ...previous, items: { ...previous.items, [targetId]: {} } }));
    if (nextItem.itemType === 'inventory' && nextItem.expiryTrackingEnabled && nextItem.inventoryProduct) {
      void loadExpiryBatchInfo(targetId, nextItem.inventoryProduct);
    }
  };

  const selectInventoryProductForQuotation = (itemId, item, product) => {
    const id = String(product?.id || product?._id || '');
    const selectedProduct = { ...product, id };
    const isNewSelection = id !== String(item.inventoryProduct || '');
    if (!isNewSelection && item.productImageRequest) return;
    const photos = inventoryProductPhotosForSelection(item.photos, item.inventoryProduct, selectedProduct);
    const productImageRequest = id && isNewSelection && !productImageEntries(selectedProduct).length
      ? Symbol('quotation product image request')
      : null;
    replaceItemRow(itemId, {
      ...item,
      ...inventoryItemFromProduct(selectedProduct, categories),
      photos,
      productImageRequest,
    });
    if (!productImageRequest) return;

    void ensureInventoryImages({ productIds: [id] }).then((images) => {
      const imageUrl = String(images.get(id) || '');
      const loadedPhotos = productImageEntries({ ...selectedProduct, imageUrl });
      setForm((previous) => {
        let changed = false;
        const items = (previous.items || []).map((current) => {
          if (String(current.itemId || current.__rowId) !== String(itemId)
            || current.productImageRequest !== productImageRequest) return current;
          changed = true;
          return {
            ...current,
            productImageRequest: null,
            photos: [...loadedPhotos.slice(0, Math.max(0, 3 - current.photos.length)), ...current.photos],
          };
        });
        return changed ? { ...previous, items } : previous;
      });
    });
  };

  const validateForm = (items) => {
    const errors = { items: {} };
    let firstInvalidField = '';
    const addError = (field, message) => {
      if (!firstInvalidField) firstInvalidField = field;
      if (field === 'customerName' || field === 'fulfillment' || field === 'taxTreatment' || field === 'authorizedSignatoryName') {
        errors[field] = message;
      }
    };

    if (!String(form.customerName || '').trim() || !form.customerId) addError('customerName', 'Select a regular customer.');
    if (form.customerVatExempt) addError('taxTreatment', 'VAT-exempt customer quotations need an approved tax rule.');
    else if (!['standard', 'vat_zero_rated'].includes(form.taxTreatment)) addError('taxTreatment', 'Select VAT-Rated or VAT Zero-Rated.');
    const authorizedSignatoryName = String(form.quotationDetails.authorizedSignatoryName || '').trim();
    if (!authorizedSignatoryName) addError('authorizedSignatoryName', 'Enter the authorized signatory name.');

    const itemValidation = validateItemRows(items);
    errors.items = itemValidation.errors;
    if (!firstInvalidField) firstInvalidField = itemValidation.firstInvalidField;

    if (!['Store Pickup', 'Free Delivery'].includes(form.fulfillment.method)) addError('fulfillment', 'Select pickup or delivery.');
    else if (form.fulfillment.method === 'Free Delivery') {
      const locationError = validateLagunaDeliveryLocation(form.fulfillment);
      if (locationError) addError('fulfillment', locationError);
    }

    return { errors, firstInvalidField };
  };

  const canAddAnotherItem = !validateItemRows((form.items || []).slice(-1)).firstInvalidField;

  const saveForm = async (event) => {
    event.preventDefault();
    if (submitInFlightRef.current || loadingProductImages) return;
    const normalizedItems = (form.items || []).map((item) => ({
      ...item,
      purchaseCost: item.purchaseCost === '' ? '' : formatMoneyInput(item.purchaseCost),
      sellingPrice: item.sellingPrice === '' ? '' : formatMoneyInput(item.sellingPrice),
    }));
    const { errors, firstInvalidField } = validateForm([...normalizedItems].reverse());
    if (firstInvalidField) {
      setFormErrors(errors);
      focusQuotationFormField(firstInvalidField);
      return;
    }
    const consolidation = consolidateQuotationItems(normalizedItems);
    if (consolidation.error) {
      const { itemId, field, message } = consolidation.error;
      setFormErrors((previous) => ({
        ...previous,
        items: { ...previous.items, [itemId]: { ...previous.items?.[itemId], [field]: message } },
      }));
      showToast('Items Not Combined', message, 'warning', 'special-order-quotation-items-consolidation-error');
      focusQuotationFormField(`items.${itemId}.${field}`);
      return;
    }
    if (consolidation.mergedGroups.length) {
      const mergedValidation = validateItemRows(consolidation.items);
      if (mergedValidation.firstInvalidField) {
        setFormErrors((previous) => ({ ...previous, items: { ...previous.items, ...mergedValidation.errors } }));
        focusQuotationFormField(mergedValidation.firstInvalidField);
        return;
      }
    }
    const quotationItems = consolidation.items;
    applyQuotationItemConsolidation(consolidation, { focusSurvivor: false });
    const authorizedSignatoryName = String(form.quotationDetails.authorizedSignatoryName || '').trim();

    setFormErrors({});

    submitInFlightRef.current = true;
    const payload = {
      quotationFirst: true,
      generateQuotation: true,
      workflowVersion: 2,
      taxTreatment: form.taxTreatment,
      fulfillment: form.fulfillment,
      quotationDetails: { ...form.quotationDetails, authorizedSignatoryName },
      customerId: form.customerId,
      customerName: normalizeHumanReadable(form.customerName),
      remarks: form.remarks,
      items: quotationItems.map((item) => ({
        itemId: item.itemId,
        itemType: item.itemType,
        photoSelections: quotationPhotoSelections(item.photos),
        inventoryProduct: item.itemType === 'inventory' ? item.inventoryProduct : null,
        sku: item.itemType === 'inventory' ? item.sku : '',
        priceOverrideReason: item.itemType === 'inventory' ? item.priceOverrideReason : '',
        itemName: normalizeHumanReadable(item.itemName),
        description: normalizeHumanReadable(item.description),
        sellingUnit: item.sellingUnit,
        expiryDate: item.itemType === 'custom' ? item.expiryDate : '',
        quotationExpirySelections: item.itemType === 'inventory' ? item.quotationExpirySelections : [],
        quantity: Number(item.quantity),
        supplierId: item.supplierId,
        supplierName: item.supplierName,
        purchaseCost: Number(item.purchaseCost),
        sellingPrice: Number(item.sellingPrice),
        expectedArrivalDate: item.expectedArrivalDate,
        remarks: item.remarks,
      })),
      clientRequestId: specialOrderCreateRequestIdRef.current || (specialOrderCreateRequestIdRef.current = createClientRequestId('special-order')),
    };

    setIsSubmitting(true);
    try {
      const saved = await createSpecialOrderApi(payload, quotationItems.map((item) => [item.itemId, item.photos.filter((photo) => !isProductImageReference(photo))]));
      if (!saved.quotation?.documentSnapshot) throw new Error('The generated quotation document is unavailable. Retry to retrieve the saved quotation.');
      const preview = buildSpecialOrderFormalQuotationModel(saved.quotation.documentSnapshot);
      let hydratedPreview = null;
      let previewError = null;
      try {
      hydratedPreview = { ...preview, items: await hydrateQuotationItems(saved._id, saved.quotation._id, preview.items) };
      } catch (imageError) {
        previewError = imageError;
      }
      detailTicketRef.current = quotationGateRef.current.begin(saved._id);
      setQuotationPreview(hydratedPreview);
      setSelectedOrder(saved);
      setQuotation(saved.quotation);
      setQuotationHistory([saved.quotation]);
      setQuotationError('');
      setOrders((previous) => [saved, ...previous.filter((row) => row._id !== saved._id)]);
      closeForm({ force: true });
      specialOrderCreateRequestIdRef.current = '';
      showToast('Quotation Generated', previewError ? `The quotation was saved, but its photo preview could not load: ${previewError.message}` : 'Awaiting the customer decision.', previewError ? 'warning' : 'success', 'special-order-save');
      logActivity(currentUserName, 'Created Special Order Quotation', `${saved.orderNumber} - ${saved.itemName}`);
      void loadOrders();
    } catch (error) {
      showToast('Generation Failed', error.message || 'Unable to generate the quotation. Your entered values are retained; retry when ready.', 'error', 'special-order-save-error');
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const completeSpecialOrderWithoutNewReference = async (order, acceptedQuotation, batchVerifications = []) => {
    if (!order?._id || orderAction || completionActionRef.current?.inFlight) return;
    const requestId = completionActionRef.current?.orderId === order._id
      ? completionActionRef.current.requestId : createClientRequestId('special-order-complete');
    completionActionRef.current = { orderId: order._id, requestId, inFlight: true };
    setOrderAction('complete-order');
    try {
      const result = await completeSpecialOrderProcessingApi(order._id, requestId, {
        quotationId: acceptedQuotation?._id,
        batchVerifications,
      });
      if (!isMountedRef.current) return;
      completionActionRef.current = null;
      if (result.order) {
        setSelectedOrder((previous) => previous?._id === result.order._id ? { ...previous, ...result.order } : previous);
        setOrders((previous) => previous.map((row) => row._id === result.order._id ? { ...row, ...result.order } : row));
      }
      if (result.receiptTransaction) setTransactions((previous) => upsertFinalizedTransaction(previous, result.receiptTransaction));
      setPostSaleFlow(null);
      showToast('Order Completed', 'The fully paid order has been completed.', 'success', 'special-order-completion-complete');
      void loadOrders();
    } catch (error) {
      if (!isMountedRef.current) return;
      setPostSaleFlow(null);
      showToast('Unable to Complete Order', error?.message || 'Reload and try again.', 'error', 'special-order-complete');
      void openOrderDetails(order);
    } finally {
      if (completionActionRef.current?.orderId === order._id) completionActionRef.current.inFlight = false;
      if (isMountedRef.current) setOrderAction('');
    }
  };

  const beginCompletion = (order, acceptedQuotation) => {
    if (!quotationCapabilities(order, acceptedQuotation, userRole, currentAuthUserId).complete && !phaseFiveCompletionReady) return;
    if (Number(order.workflowVersion) >= 2) {
      const requestId = completionActionRef.current?.orderId === order._id
        ? completionActionRef.current.requestId : createClientRequestId('special-order-complete');
      completionActionRef.current = { orderId: order._id, requestId, inFlight: false };
      const batchItems = (stockAvailability?.items || []).filter((item) => item.itemType === 'inventory' && item.expiryTrackingEnabled)
        .map((item) => ({
          productId: String(item.productId),
          name: item.itemName,
          sku: item.sku,
          quantity: Number(item.orderedQuantity || 0),
          unit: item.sellingUnit || '',
          reconciled: item.expiryBatchReconciled === true,
          proposedAllocations: item.proposedBatchAllocations || null,
          batchOptions: item.batchOptions || [],
          productStock: item.productStock,
          productReserved: item.productReserved,
          error: item.reservationNeedsReview && !item.expiryBatchReconciled ? 'Batch verification needed. Verify batches in Inventory before completing this order.' : '',
        }));
      if (order.linkedSaleId && batchItems.length === 0) {
        quotationGateRef.current.invalidate();
        detailLoadRef.current = null;
        setDetailLoading(null);
        setQuotationLoading(false);
        void completeSpecialOrderWithoutNewReference(order, acceptedQuotation);
        return;
      }
      setPostSaleFlow({ order, quotation: acceptedQuotation, phase: batchItems.length ? 'batch-verification' : 'reference', completionFlow: true,
        existingSale: Boolean(order.linkedSaleId), batchItems, batchVerificationRecords: {}, batchVerifications: [], referenceDraft: { referenceNumber: '', documentFile: null } });
      quotationGateRef.current.invalidate();
      detailLoadRef.current = null;
      setDetailLoading(null);
      setQuotationLoading(false);
      setSelectedOrder(null);
      return;
    }
    setPostSaleFlow((previous) => {
      if (previous?.order?._id === order._id && previous?.quotation?._id === acceptedQuotation._id) return { ...previous, phase: 'confirmation' };
      return { order, quotation: acceptedQuotation, phase: 'confirmation', referenceDraft: { referenceNumber: '', documentFile: null },
        transaction: { ...acceptedQuotationTransaction(order, acceptedQuotation, currentUserName || 'Current cashier'),
          ...(phaseFiveCompletionReady ? { paymentStatus: 'Paid', amountPaid: Number(acceptedQuotation.total), remainingBalance: 0 } : {}) } };
    });
    quotationGateRef.current.invalidate();
    detailLoadRef.current = null;
    setDetailLoading(null);
    setQuotationLoading(false);
    setSelectedOrder(null);
  };

  const closeDetails = () => {
    if (quotationActionRef.current) return;
    quotationGateRef.current.invalidate();
    detailLoadRef.current = null;
    setDetailLoading(null);
    setQuotationLoading(false);
    setSelectedOrder(null);
    setQuotation(null);
    setQuotationHistory([]);
    setQuotationDraft(null);
    setQuotationEditorOpen(false);
    setQuotationError('');
    setDecisionOpen(false);
    setCompletionConfirmOpen(false);
    completionConfirmTriggerRef.current = null;
    setPaymentOpen(false);
    setPaymentLedger(null);
    setPaymentError('');
    setPaymentProofPreview(null);
    completionActionRef.current = null;
    paymentDraftOrderRef.current = '';
    paymentRequestRef.current = '';
    setPaymentForm({ amount: '', downPaymentPercentage: '50', paymentPlan: 'cash', termDays: '30', method: 'cash', otherMethod: '', reference: '', notes: '', chequeCleared: false, invoiceNumber: '', saleDocuments: [], proofs: [] });
  };

  const loadFinalizedSpecialOrderReceipt = async (order) => {
    const result = await getSpecialOrderReceiptApi(order._id);
    if (!result?.receiptTransaction) {
      throw new Error('Finalized sale data is unavailable for this transaction.');
    }
    return {
      order: result.order || order,
      receiptTransaction: result.receiptTransaction,
    };
  };

  const continueToTransactionReference = () => {
    if (detailLoadRef.current) {
      quotationGateRef.current.invalidate();
      detailLoadRef.current = null;
      setDetailLoading(null);
      setQuotationLoading(false);
    }
    setPostSaleFlow((previous) => previous ? { ...previous, phase: 'reference' } : previous);
  };

  const finalizePostSaleFlow = async ({ referenceNumber, documentFile }) => {
    if (!postSaleFlow?.order?._id) throw new Error('Special order completion data is unavailable.');
    if (postSaleFlow.completionFlow) {
      const completion = completionActionRef.current;
      if (!completion || completion.orderId !== postSaleFlow.order._id || completion.inFlight) {
        throw new Error('Special order completion is already processing.');
      }
      completion.inFlight = true;
      setOrderAction('complete-order');
      try {
        const result = await completeSpecialOrderProcessingApi(postSaleFlow.order._id, completion.requestId, {
          referenceNumber,
          documentFile,
          quotationId: postSaleFlow.quotation?._id,
          batchVerifications: postSaleFlow.batchVerifications || [],
        });
        if (result?.order) setOrders((previous) => previous.map((row) => row._id === result.order._id ? result.order : row));
        return result;
      } finally {
        completion.inFlight = false;
        if (isMountedRef.current) setOrderAction('');
      }
    }
    const result = await finalizeSpecialOrderWithReferenceApi(postSaleFlow.order._id, {
      referenceNumber,
      documentFile,
      quotationId: postSaleFlow.quotation?._id,
    });
    if (result?.order) setOrders((previous) => previous.map((row) => row._id === result.order._id ? result.order : row));
    return result?.receiptTransaction;
  };

  const viewCompletedTransaction = async (order) => {
    if (orderAction || (!order?.linkedSaleId && order?.status !== 'Completed')) return;
    const ticket = quotationGateRef.current.begin(order._id);
    setOrderAction('resume-reference');
    try {
      const finalized = await loadFinalizedSpecialOrderReceipt(order);
      if (!isMountedRef.current || !quotationGateRef.current.isCurrent(ticket)) return;
      setSelectedOrder(null);
      quotationGateRef.current.invalidate();
      setImageError('');
      setCompletedTransactionPreview(finalized);
    } catch (error) {
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) showToast('Transaction Unavailable', error?.message || 'Unable to load the finalized transaction.', 'error', 'special-order-reference-load-error');
    } finally {
      if (isMountedRef.current) setOrderAction('');
    }
  };

  const finishPostSaleFlow = (updatedSale) => {
    if (!postSaleFlow) return;
    if (postSaleFlow.completionFlow) {
      const completedOrder = updatedSale?.order;
      if (completedOrder) setOrders((previous) => previous.map((row) => row._id === completedOrder._id ? completedOrder : row));
      if (updatedSale?.receiptTransaction) setTransactions((previous) => upsertFinalizedTransaction(previous, updatedSale.receiptTransaction));
      completionActionRef.current = null;
      setPostSaleFlow(null);
      showToast('Order Completed', 'The fully paid order has been completed.', 'success', 'special-order-completion-complete');
      void loadOrders();
      return;
    }
    const completedTransaction = {
      ...postSaleFlow.transaction,
      ...updatedSale,
      transactionReference: updatedSale?.transactionReference || postSaleFlow.transaction.transactionReference,
    };

    setTransactions((previous) => upsertFinalizedTransaction(previous, completedTransaction));
    setPostSaleFlow(null);
    showToast(
      'Sale Recorded',
      completedTransaction.id
        ? `Transaction ${completedTransaction.id} is saved. Physical fulfillment remains pending.`
        : 'The financial Sale is saved. Physical fulfillment remains pending.',
      'success',
      'special-order-transaction-reference-complete',
      { duration: 4000 }
    );
    void loadOrders();
  };

  const downloadSpecialOrderPdf = async (order) => {
    if (orderAction || (!order?.linkedSaleId && order?.status !== 'Completed')) return;

    setOrderAction('download-pdf');
    try {
      const finalized = await loadFinalizedSpecialOrderReceipt(order);
      const filename = await downloadSpecialOrderTransactionPdf({
        order: finalized.order,
        transaction: finalized.receiptTransaction,
        settings: appSettings,
        logoSource: logo,
      });
      showToast('Download Ready', `${filename} has been downloaded.`, 'success', 'special-order-pdf-success');
    } catch (error) {
      showToast('Download Failed', `${error?.message || 'Unable to generate the Special Order PDF.'} The completed order was not changed; please try again.`, 'error', 'special-order-pdf-error');
    } finally {
      setOrderAction('');
    }
  };

  const replaceQuotation = (updated) => {
    setQuotation(updated);
    setQuotationHistory((previous) => [updated, ...previous.filter((row) => row._id !== updated._id)]);
    setSelectedOrder((previous) => previous ? { ...previous, quotation: updated, currentQuotation: updated._id } : previous);
    setOrders((previous) => previous.map((row) => row._id === selectedOrder?._id ? { ...row, quotation: updated, currentQuotation: updated._id } : row));
  };

  const openQuotationEditor = (value = quotation) => {
    if (quotationBusy || value?.status !== 'Draft' || !value.isCurrent || !quotationActions.allowed) return;
    setQuotationDraft(createQuotationDraft(value, appSettings));
    setQuotationError('');
    setQuotationEditorOpen(true);
  };

  const closeQuotationEditor = () => {
    if (quotationActionRef.current) return;
    setQuotationEditorOpen(false);
    setQuotationDraft(null);
    setQuotationError('');
  };

  const runQuotationAction = async (action, work) => {
    if (!selectedOrder || quotationLoading || (quotationError && !quotationEditorOpen && !decisionOpen) || quotationActionRef.current) return;
    quotationActionRef.current = true;
    const ticket = detailTicketRef.current;
    setOrderAction(action);
    try {
      await work(() => isMountedRef.current && quotationGateRef.current.isCurrent(ticket));
    } catch (error) {
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) {
        setQuotationError(error?.message || 'Unable to complete this action. Retry or reload the order.');
        showToast('Action Failed', error?.message || 'Unable to complete this action.', 'error', 'special-order-quotation-action');
      }
    } finally {
      quotationActionRef.current = false;
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) setOrderAction('');
    }
  };

  const prepareQuotation = () => runQuotationAction('prepare-quotation', async (isCurrent) => {
    const created = await prepareSpecialOrderQuotationApi(selectedOrder._id);
    if (!isCurrent()) return;
    replaceQuotation(created);
    setSelectedOrder((previous) => ({ ...previous, currentQuotation: created._id }));
    setQuotationDraft(createQuotationDraft(created, appSettings));
    setQuotationEditorOpen(true);
    setQuotationError('');
  });

  const saveQuotationDraft = (generate = false) => {
    if (!quotationDraft || !quotationActions.edit || !quotationDraftSummary(quotationDraft).valid) return;
    if (generate && !quotationDraft.quotationDetails.authorizedSignatoryName.trim()) {
      setQuotationError('Authorized Signatory Name is required to generate a quotation.');
      return;
    }
    void runQuotationAction(generate ? 'generate-quotation' : 'save-quotation', async (isCurrent) => {
      const saved = await updateSpecialOrderQuotationApi(selectedOrder._id, quotation._id, quotationDraft);
      if (!isCurrent()) return;
      replaceQuotation(saved);
      if (generate) {
        const issued = await issueSpecialOrderQuotationApi(selectedOrder._id, saved._id);
        if (!isCurrent()) return;
        replaceQuotation(issued);
        const model = buildSpecialOrderFormalQuotationModel(issued.documentSnapshot);
    const withImages = { ...model, items: await hydrateQuotationItems(selectedOrder._id, issued._id, model.items) };
        setQuotationPreview(withImages);
      }
      setQuotationError('');
      setQuotationDraft(null);
      setQuotationEditorOpen(false);
      showToast(generate ? 'Quotation Generated' : 'Draft Saved', generate ? 'Awaiting the customer decision.' : 'Quotation details were saved.', 'success', 'special-order-quotation-save');
    });
  };

  const updateDraftImages = (updated, replacedKey = '', replacementKey = '') => {
    replaceQuotation(updated);
    setQuotationDraft((previous) => previous ? { ...previous, items: previous.items.map((item) => {
      const remoteImages = updated.items?.find((entry) => entry.itemId === item.itemId)?.images;
      if (!remoteImages) return item;
      const remoteByKey = new Map(remoteImages.map((image) => [image.key, image]));
      const orderedKeys = (item.imageKeys || item.images?.map((image) => image.key) || []).map((key) => key === replacedKey ? replacementKey : key);
      const images = [...orderedKeys.map((key) => remoteByKey.get(key)).filter(Boolean), ...remoteImages.filter((image) => !orderedKeys.includes(image.key))];
      return { ...item, images, imageKeys: images.map((image) => image.key) };
    }) } : previous);
  };

  const uploadQuotationImages = (itemId, files, replaceKey = '') => {
    const selected = Array.from(files || []);
    if (selected.length > 3 || selected.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) { setQuotationError('Each product photo must be a JPG, PNG, or WebP image no larger than 5 MB (maximum 3 per product).'); return; }
    void runQuotationAction('upload-quotation-image', async (isCurrent) => {
      let activeQuotation = quotation;
      // Legacy drafts did not have stable item IDs. Persist the local draft once
      // before upload so files are never associated by array position.
      if (!quotation.items?.some((item) => item.itemId === itemId)) {
        activeQuotation = await updateSpecialOrderQuotationApi(selectedOrder._id, quotation._id, quotationDraft);
        if (!isCurrent()) return;
        replaceQuotation(activeQuotation);
      }
      const updated = await uploadSpecialOrderQuotationImagesApi(selectedOrder._id, activeQuotation._id, itemId, selected, replaceKey);
      if (isCurrent()) {
        const previousKeys = new Set(activeQuotation.items?.find((item) => item.itemId === itemId)?.images?.map((image) => image.key) || []);
        const replacementKey = replaceKey ? updated.items?.find((item) => item.itemId === itemId)?.images?.find((image) => !previousKeys.has(image.key))?.key : '';
        updateDraftImages(updated, replaceKey, replacementKey);
      }
    });
  };

  const removeQuotationImage = (itemId, imageKey) => void runQuotationAction('remove-quotation-image', async (isCurrent) => {
    const updated = await removeSpecialOrderQuotationImageApi(selectedOrder._id, quotation._id, itemId, imageKey);
    if (isCurrent()) updateDraftImages(updated);
  });

  const recordQuotationDecision = (decision) => runQuotationAction('quotation-decision', async (isCurrent) => {
    const updated = await decideSpecialOrderQuotationApi(selectedOrder._id, quotation._id, decision, decision === 'Declined' ? declineReason : '');
    if (!isCurrent()) return;
    const { order, ...decidedQuotation } = updated;
    replaceQuotation(decidedQuotation);
    const view = { ...order, quotation: decidedQuotation };
    setSelectedOrder(view);
    setOrders((previous) => previous.map((row) => row._id === view._id ? view : row));
    setDecisionOpen(false);
    setQuotationError('');
    if (decision === 'Accepted' && Number(view.workflowVersion) >= 2 && !paymentLedger) {
      paymentDraftOrderRef.current = String(view._id);
      paymentRequestRef.current = '';
      setPaymentLedger(null);
      setPaymentError('');
      setPaymentForm({ amount: getSpecialOrderDownPaymentInput(decidedQuotation.total, '50'), downPaymentPercentage: '50', paymentPlan: 'cash', termDays: '30', method: 'cash', otherMethod: '', reference: '', notes: '', chequeCleared: false, invoiceNumber: '', saleDocuments: [], proofs: [] });
      setPaymentOpen(true);
    }
    if (Number(view.workflowVersion) >= 2) {
      try { setStockAvailability(await getSpecialOrderStockAvailabilityApi(view._id)); }
      catch (error) { setStockError(error?.message || 'Refresh availability to see current stock.'); }
    }
    showToast('Decision Recorded', decision === 'Accepted' ? 'Order activated: In Progress. No sale has been created.' : 'Request cancelled. The decision is final.', 'success', 'special-order-quotation-decision');
    void loadOrders();
  });

  const refreshStockAvailability = async (order = selectedOrder) => {
    if (!order || stockLoading) return;
    const ticket = detailTicketRef.current;
    setStockLoading(true);
    setStockError('');
    try {
      const availability = await getSpecialOrderStockAvailabilityApi(order._id);
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) setStockAvailability(availability);
    } catch (error) {
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) setStockError(error?.message || 'Unable to refresh stock availability.');
    } finally {
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) setStockLoading(false);
    }
  };

  const reportPaymentFieldError = (field, message) => {
    setPaymentError(message);
    const scope = document.querySelector('[data-validation-scope="special-order-payment"]');
    if (scope) setFormValidationErrors(scope, { [field]: message });
  };

  const handleSpecialOrderCreditTermChange = (value) => {
    setPaymentForm((previous) => ({ ...previous, termDays: sanitizeWholeNumberInput(value) }));
  };

  const incrementSpecialOrderCreditTerm = () => {
    setPaymentForm((previous) => {
      if (previous.termDays === '') return { ...previous, termDays: String(SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS) };
      if (!isWholeNumberInput(previous.termDays, { min: SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS, max: SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS })) return previous;
      return { ...previous, termDays: String(Math.min(SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS, Number(previous.termDays) + 1)) };
    });
  };

  const decrementSpecialOrderCreditTerm = () => {
    setPaymentForm((previous) => {
      if (!isWholeNumberInput(previous.termDays, { min: SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS, max: SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS })) return previous;
      return { ...previous, termDays: String(Math.max(SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS, Number(previous.termDays) - 1)) };
    });
  };

  const recordPayment = async () => {
    if (!selectedOrder || !quotation || !canProcessSpecialOrder || paymentInFlightRef.current) return;
    const amount = parseMoneyToCentavos(paymentForm.amount);
    const total = parseMoneyToCentavos(String(quotation.total));
    const additional = Boolean(paymentLedger);
    const downPaymentPercentageBasisPoints = parseDownPaymentPercentageBasisPoints(paymentForm.downPaymentPercentage);
    const requiredAmount = additional ? paymentLedger.remainingBalanceCentavos : parseMoneyToCentavos(getSpecialOrderDownPaymentInput(String(quotation.total), paymentForm.downPaymentPercentage));
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total) || (additional ? amount !== requiredAmount : downPaymentPercentageBasisPoints === null || requiredAmount === null || amount !== requiredAmount)) {
      const message = additional ? 'The remaining Cash Special Order balance must be paid in full.' : 'Choose a percentage above 0% and no more than 100%, then pay the calculated down payment.';
      if (!additional) reportPaymentFieldError('downPaymentPercentage', message);
      else setPaymentError(message);
      return;
    }
    if (!additional && paymentForm.paymentPlan === 'credit' && (!isWholeNumberInput(paymentForm.termDays) || Number(paymentForm.termDays) < 1 || Number(paymentForm.termDays) > 60)) {
      reportPaymentFieldError('termDays', 'Credit terms must be between 1 and 60 days.');
      return;
    }
    if (additional && paymentLedger?.paymentPlan === 'credit') {
      setPaymentError('Settle the remaining balance through the linked Credit Transaction.');
      return;
    }
    if (!amount || !total || (additional ? amount > paymentLedger.remainingBalanceCentavos : amount > total)) {
      setPaymentError(additional ? 'Payment must be at least ₱0.01 and no more than the remaining balance.' : 'Down payment must be at least ₱0.01 and no more than the approved quotation total.');
      return;
    }
    if (paymentForm.method !== 'cash' && !paymentForm.reference.trim() && paymentForm.proofs.length === 0) {
      reportPaymentFieldError('reference', 'Provide a payment reference or payment proof.');
      return;
    }
    if (paymentForm.method === 'cheque' && !paymentForm.chequeCleared) {
      reportPaymentFieldError('chequeCleared', 'Confirm that the cheque has cleared before recording payment.');
      return;
    }
    if (finalCustomPayment && ((!paymentForm.invoiceNumber.trim() && paymentForm.saleDocuments.length === 0) || getTransactionReferenceNumberError(paymentForm.invoiceNumber))) {
      reportPaymentFieldError('invoiceNumber', getTransactionReferenceNumberError(paymentForm.invoiceNumber) || 'Provide an Invoice No. or Supporting Document to record the Sale.');
      return;
    }
    if (paymentForm.proofs.length > 3) {
      reportPaymentFieldError('proofs', 'Choose up to 3 proof photos.');
      return;
    }
    paymentInFlightRef.current = true;
    if (!paymentRequestRef.current) paymentRequestRef.current = createClientRequestId('special-order-payment');
    const orderId = selectedOrder._id;
    const ticket = detailTicketRef.current;
    setOrderAction('record-payment');
    setPaymentError('');
    try {
      const result = await (additional ? recordSpecialOrderPaymentApi : recordSpecialOrderDownPaymentApi)(orderId, { ...paymentForm, requestId: paymentRequestRef.current });
      if (!isMountedRef.current || !quotationGateRef.current.isCurrent(ticket)) return;
      setPaymentLedger(result.ledger);
      if (result.order) {
        setSelectedOrder((previous) => previous?._id === result.order._id ? { ...previous, ...result.order } : previous);
        setOrders((previous) => previous.map((row) => row._id === result.order._id ? { ...row, ...result.order } : row));
      }
      if (result.availability) setStockAvailability(result.availability);
      setPaymentOpen(false);
      setPaymentForm({ amount: '', downPaymentPercentage: '50', paymentPlan: 'cash', termDays: '30', method: 'cash', otherMethod: '', reference: '', notes: '', chequeCleared: false, invoiceNumber: '', saleDocuments: [], proofs: [] });
      paymentRequestRef.current = '';
      void loadOrders();
      if (result.ledger?.paymentPlan === 'credit') {
        showToast('Credit Transaction Created', `${result.ledger.creditTransactionId} manages the remaining balance and credit terms.`, 'success');
        return;
      }
      showToast(result.order?.linkedSaleId ? 'Payment and Sale Recorded' : additional ? 'Payment Recorded' : 'Down Payment Recorded',
        result.order?.linkedSaleId ? 'The financial Sale is recorded. Check any inventory-linked stock before completing the order.' : additional ? 'Payment added to this order.' : customOnlyQuotation ? 'Down payment documented; no inventory operation was required.' : 'Down payment documented and available inventory stock reserved.', 'success');
    } catch (error) {
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) setPaymentError(error?.message || 'Payment could not be recorded. Retry with the same request.');
    } finally {
      paymentInFlightRef.current = false;
      if (isMountedRef.current) setOrderAction('');
    }
  };

  const confirmCompletion = () => {
    if (!selectedOrder || !canProcessSpecialOrder || orderAction || completionActionRef.current?.inFlight
      || selectedOrder.status !== 'In Progress' || Number(selectedOrder.workflowVersion) < 2) return;
    setCompletionConfirmOpen(false);
    completionConfirmTriggerRef.current = null;
    // Physical batch confirmation (when needed) and the existing reference step
    // happen before the transactional completion request. No stock or sale is
    // changed by dismissing this confirmation dialog.
    beginCompletion(selectedOrder, quotation);
  };

  const viewPaymentProof = async (payment, index) => {
    if (!selectedOrder || orderAction) return;
    const ticket = detailTicketRef.current;
    setPaymentError('');
    try {
      const blob = await getSpecialOrderPaymentProofApi(selectedOrder._id, payment.requestId, index);
      if (!isMountedRef.current || !quotationGateRef.current.isCurrent(ticket)) return;
      setPaymentProofPreview({ url: URL.createObjectURL(blob), name: payment.proofs[index]?.fileName || 'Payment proof' });
    } catch (error) {
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) setPaymentError(error?.message || 'Payment proof is unavailable.');
    }
  };

  const performStockAction = async (action, reason = '') => {
    const canPerformAction = action === 'Reserve' ? canProcessSpecialOrder : canManageOrderExceptions;
    if (!selectedOrder || !canPerformAction || orderAction || quotationLoading) return;
    const orderId = selectedOrder._id;
    const ticket = detailTicketRef.current;
    const prior = stockActionRequestRef.current;
    const requestId = prior?.orderId === orderId && prior.action === action ? prior.requestId : createClientRequestId('special-order-stock');
    stockActionRequestRef.current = { orderId, action, requestId };
    setOrderAction(`stock-${action}`);
    setStockError('');
    try {
      const result = action === 'Reserve' ? await reserveSpecialOrderStockApi(orderId, requestId)
        : action === 'Release' ? await releaseSpecialOrderStockApi(orderId, requestId)
          : await cancelReservedSpecialOrderApi(orderId, requestId, reason);
      if (!isMountedRef.current || !quotationGateRef.current.isCurrent(ticket)) return;
      stockActionRequestRef.current = null;
      if (action === 'Cancel') {
        setSelectedOrder((previous) => previous ? { ...previous, ...result.order } : previous);
        setOrders((previous) => previous.map((row) => row._id === orderId ? { ...row, ...result.order } : row));
        setStockAvailability(result.availability);
        void loadOrders();
      } else setStockAvailability(result);
      showToast('Stock Updated', action === 'Reserve' ? 'Available stock reserved. Any shortage still requires Stock In.' : action === 'Release' ? 'Reservation released without changing physical stock.' : 'Order cancelled and active reservations released.', 'success');
    } catch (error) {
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) setStockError(error?.message || 'Stock action failed. Refresh and retry.');
    } finally {
      if (isMountedRef.current && quotationGateRef.current.isCurrent(ticket)) setOrderAction('');
    }
  };

  const reviseQuotation = () => runQuotationAction('revise-quotation', async (isCurrent) => {
    const revision = await reviseSpecialOrderQuotationApi(selectedOrder._id, quotation._id);
    if (!isCurrent()) return;
    setQuotationHistory((previous) => [revision, ...previous.map((row) => row._id === quotation._id ? { ...row, status: 'Superseded', isCurrent: false } : row)]);
    setQuotation(revision);
    setSelectedOrder((previous) => ({ ...previous, quotation: revision, currentQuotation: revision._id, transactionQuotation: null, status: 'Pending' }));
    setQuotationDraft(createQuotationDraft(revision, appSettings));
    setQuotationEditorOpen(true);
    setQuotationError('');
    setPostSaleFlow((previous) => previous?.order?._id === selectedOrder._id ? null : previous);
    void loadOrders();
  });

  const openQuotationPreview = (value = quotation) => runQuotationAction('preview-quotation', async (isCurrent) => {
    if (!value) return;
    const document = await getSpecialOrderQuotationDocumentApi(selectedOrder._id, value._id);
    if (!isCurrent()) return;
    const model = buildSpecialOrderFormalQuotationModel(document);
    const withImages = { ...model, items: await hydrateQuotationItems(selectedOrder._id, value._id, model.items) };
    if (isCurrent()) setQuotationPreview(withImages);
  });

  const closeCompletedPreview = () => {
    imageRequestRef.current += 1;
    setImageLoading(false);
    setSupportingImage(null);
    setCompletedTransactionPreview(null);
  };
  useEffect(() => () => { if (supportingImage?.url) URL.revokeObjectURL(supportingImage.url); }, [supportingImage]);
  const previewSupportingImage = async () => {
    if (imageLoading || !completedTransactionPreview) return;
    const request = ++imageRequestRef.current;
    setImageLoading(true);
    setImageError('');
    try {
      const blob = await getSaleSupportingDocumentApi(completedTransactionPreview.receiptTransaction.sourceId);
      if (!isMountedRef.current || request !== imageRequestRef.current) return;
      if (!['image/png', 'image/jpeg'].includes(blob.type)) throw new Error('The saved supporting image is unavailable.');
      setSupportingImage({ url: URL.createObjectURL(blob), name: completedTransactionPreview.receiptTransaction.transactionReference.supportingDocument.originalName || 'Supporting Image' });
    } catch (error) {
      if (isMountedRef.current && request === imageRequestRef.current) setImageError(error.message || 'The saved supporting image is unavailable.');
    } finally { if (isMountedRef.current && request === imageRequestRef.current) setImageLoading(false); }
  };

  const nextAction = (() => {
    if (!selectedOrder) return null;
    if (selectedOrder.status === 'Completed') {
      return { title: 'Order Completed', detail: `Completed${selectedOrder.completedAt ? ` · ${new Date(selectedOrder.completedAt).toLocaleString()}` : ''}. Review the transaction or download its document.` };
    }
    if (Number(selectedOrder.workflowVersion) >= 2 && selectedOrder.status === 'In Progress' && !(quotationError || paymentError || stockError)) {
      if (quotation?.status !== 'Accepted' || !quotation?.isCurrent || String(selectedOrder.transactionQuotation || '') !== String(quotation?._id || '') || !approvedTaxTreatment) {
        return { title: 'Order needs review', detail: 'The current accepted quotation or its approved tax classification could not be verified.' };
      }
      if (!paymentLedger || paymentLedger.status !== 'Fully Paid' || paymentLedger.remainingBalanceCentavos !== 0) {
        return canProcessSpecialOrder
          ? { title: 'Payment Required', detail: 'Settle the remaining balance to continue.', action: 'record-payment' }
          : { title: 'Payment Required', detail: 'Settle the remaining balance to continue.' };
      }
      if (stockLoading || !stockAvailability) return { title: 'Checking Stock', detail: 'Checking stock availability before completion.' };
      const blockedInventory = inventoryPreparationItems.filter((item) => item.reservationNeedsReview || Number(item.shortage || 0) > 0);
      if (blockedInventory.length || !stockAvailability.fulfillment?.canComplete) {
        return { title: 'Stock Required', detail: 'Insufficient stock to complete this order.', action: canProcessSpecialOrder ? 'preparation' : null, secondary: true };
      }
      return canProcessSpecialOrder
        ? { title: 'Ready to Complete', detail: inventoryPreparationItems.length ? 'Fully paid. Stock available.' : 'Fully paid.', action: 'complete-order' }
        : { title: 'Ready to Complete', detail: 'You do not have permission to complete this order.' };
    }
    if (quotationError || paymentError || stockError) {
      return { title: 'Some order details need to be refreshed', detail: quotationError || paymentError || stockError, action: 'reload', secondary: true };
    }
    if (selectedOrder.status === 'Pending') {
      if (quotationActions.decide) return { title: 'Customer decision needed', detail: 'Record the customer’s decision on the current quotation.', action: 'decision' };
      if (quotationActions.generate) return { title: 'Quotation ready to generate', detail: 'Review the draft and generate the customer quotation.', action: 'generate-quotation' };
      if (quotationActions.prepare) return { title: 'Prepare a quotation', detail: 'Add the agreed items and details to continue.', action: 'prepare-quotation' };
      return { title: 'Special Order in progress', detail: quotation?.status ? `Current quotation: ${quotation.status}.` : 'Review the order details and quotation history.' };
    }
    if (selectedOrder.status === 'In Progress') {
      if (Number(selectedOrder.workflowVersion) < 2 && quotationActions.complete) return { title: 'Order is ready for completion', detail: 'Continue to the transaction confirmation.', action: 'legacy-complete' };
    }
    return { title: 'Review the order details', detail: 'Check the current order and quotation status.' };
  })();
  const showPaymentSection = Number(selectedOrder?.workflowVersion) >= 2
    && (Boolean(paymentLedger) || (selectedOrder.status === 'In Progress' && quotation?.status === 'Accepted'));
  const approvedPaymentTotal = paymentLedger
    ? Number(paymentLedger.approvedTotalCentavos || 0) / 100
    : Number(quotation?.total ?? selectedSummary?.total ?? 0);
  const totalPaid = paymentLedger ? Number(paymentLedger.amountPaidCentavos || 0) / 100 : 0;
  const remainingBalance = paymentLedger
    ? Number(paymentLedger.remainingBalanceCentavos || 0) / 100
    : approvedPaymentTotal;
  const isCreditSpecialOrder = paymentLedger?.paymentPlan === 'credit';
  const paymentStatus = paymentLedger?.status || (nextAction?.action === 'record-payment' ? 'Payment Required' : 'Needs Review');
  const initialDownPayment = paymentLedger?.payments?.find((payment) => payment.type === 'down_payment');
  const paymentSummaryMetrics = [
    { label: 'Approved Total', value: formatMoney(approvedPaymentTotal) },
    { label: 'Payment Plan', value: paymentLedger ? (isCreditSpecialOrder ? 'Credit' : 'Cash') : 'Not selected' },
    { label: 'Total Paid', value: formatMoney(totalPaid) },
    { label: 'Remaining Balance', value: formatMoney(remainingBalance), prominent: remainingBalance > 0 },
    { label: 'Payment Status', value: paymentStatus },
    { label: 'Initial Down Payment', value: initialDownPayment ? `${formatMoney(initialDownPayment.amountCentavos / 100)}${paymentLedger?.downPaymentPercentage != null ? ` (${paymentLedger.downPaymentPercentage}%)` : ''}` : 'Not recorded' },
  ];

  const runNextAction = () => {
    if (!nextAction?.action || !selectedOrder) return;
    if (nextAction.action === 'complete-order') {
      if (!canProcessSpecialOrder || orderAction || selectedOrder.status !== 'In Progress') return;
      completionConfirmTriggerRef.current = document.activeElement;
      setCompletionConfirmOpen(true);
    }
    else if (nextAction.action === 'reload') void openOrderDetails(selectedOrder);
    else if (nextAction.action === 'decision') setDecisionOpen(true);
    else if (nextAction.action === 'generate-quotation') openQuotationEditor();
    else if (nextAction.action === 'prepare-quotation') void prepareQuotation();
    else if (nextAction.action === 'record-payment') {
      if (isCreditSpecialOrder) {
        if (!paymentLedger?.creditTransactionId) {
          showToast('Credit Transaction Unavailable', 'The linked Credit Transaction could not be identified. Request administrative review.', 'error', 'special-order-credit-link-missing');
          return;
        }
        navigate(`/credit-transactions?search=${encodeURIComponent(paymentLedger.creditTransactionId)}`);
      } else setPaymentOpen(true);
    }
    else if (nextAction.action === 'legacy-complete') beginCompletion(selectedOrder, quotation);
    else if (nextAction.action === 'preparation') document.getElementById('special-order-preparation')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const buildRowActions = (order) => {
    const capabilities = quotationCapabilities(order, order.quotation, userRole, currentAuthUserId);
    let nextAction = null;
    if (Number(order.workflowVersion) >= 2 && order.status === 'In Progress') {
      nextAction = getPhaseFiveTableNextAction({
        order,
        quotation: order.quotation,
        ...(rowWorkflowData[String(order._id)] || { paymentLoading: true }),
        role: userRole,
        userId: currentAuthUserId,
      });
    }
    const primaryAction = nextAction && ['record-payment', 'complete-order'].includes(nextAction.type)
      ? { ...nextAction, primary: true,
        loadingKey: nextAction.type === 'record-payment' || nextAction.type === 'payment-blocked' ? 'payment' : 'complete-order',
        icon: nextAction.type === 'complete-order' || nextAction.type === 'complete-blocked' ? 'circle-check' : null,
        label: nextAction.type === 'record-payment' && rowWorkflowData[String(order._id)]?.paymentLedger?.paymentPlan === 'credit'
          ? 'Open Credit Transaction'
          : nextAction.label,
        run: () => nextAction.type === 'record-payment'
          ? openOrderDetails(order, { action: 'payment' })
          : nextAction.type === 'complete-order' ? openOrderDetails(order, { action: 'complete-order' }) : undefined,
      } : null;
    const legacyComplete = capabilities.complete && Number(order.workflowVersion) < 2
      ? { label: 'Complete Order', icon: 'circle-check', primary: true, loadingKey: 'complete-order', run: () => beginCompletion(order, order.quotation) }
      : null;
    const primary = primaryAction || legacyComplete;
    const rowActions = [
      { label: 'View Details', icon: 'eye', loadingKey: 'details', run: () => openOrderDetails(order) },
      ...(capabilities.decide ? [{ label: 'Record Decision', icon: 'clipboard-check', primary: true, loadingKey: 'decide', run: () => openOrderDetails(order, { action: 'decide' }) }] : []),
      ...(primary ? [primary] : []),
      ...(canViewSpecialOrderTransaction(order, capabilities.allowed)
        ? [{ label: 'View Transaction', icon: 'file-text', loadingKey: 'transaction', run: () => viewCompletedTransaction(order) }]
        : []),
    ];
    return rowActions.map((action) => ({ ...action, orderId: String(order._id) }));
  };
  const renderRowActionButton = (action, { fullWidth = false, stopPropagation = false, menuItem = false, onAction } = {}) => {
    const loadingAction = detailLoading?.orderId === String(action.orderId || '') ? detailLoading.action : null;
    return (
      <SpecialOrderRowActionButton
        key={action.label}
        action={action}
        busy={quotationBusy}
        loadingAction={loadingAction}
        fullWidth={fullWidth}
        stopPropagation={stopPropagation}
        menuItem={menuItem}
        onAction={onAction}
      />
    );
  };
  const renderOrderRowActions = (order, rowActions, { mobile = false } = {}) => {
    const detailsAction = rowActions.find((action) => action.label === 'View Details');
    const secondaryActions = rowActions.filter((action) => action.label !== 'View Details');
    return (
      <div className={`flex min-w-0 items-center justify-center gap-1.5 ${mobile ? 'w-full' : ''}`}>
        {detailsAction && renderRowActionButton(detailsAction, { fullWidth: mobile, stopPropagation: true })}
        {secondaryActions.length > 0 && (
          <SpecialOrderActionMenu
            actions={secondaryActions}
            orderNumber={order.orderNumber}
            disabled={quotationBusy}
            loadingAction={detailLoading?.orderId === String(order._id) ? detailLoading.action : null}
          />
        )}
      </div>
    );
  };

  useEffect(() => {
    if (!itemRemovalTargetId) return undefined;
    itemRemovalCancelRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeItemRemovalConfirmation();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [itemRemovalTargetId, closeItemRemovalConfirmation]);

  const itemRemovalSummary = itemRemovalTargetId
    ? getQuotationItemRemovalSummary((form.items || []).find((item) => String(item.itemId) === itemRemovalTargetId || String(item.__rowId) === itemRemovalTargetId))
    : [];

  return (
    <div className="flex h-auto flex-col gap-2 md:h-[calc(100vh-80px)] md:min-h-0 md:overflow-hidden">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none md:h-full md:rounded-2xl md:border md:border-slate-300 md:bg-slate-200/50 md:p-4 md:shadow-inner">
        <header className="flex flex-col items-start gap-1 border-b border-gray-200 px-2 pb-3 md:px-0">
          <div>
            <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Special Orders</p>
            <p className="text-[11px] font-medium text-gray-500 md:text-xs">Create, track, and complete customer-requested items.</p>
          </div>
        </header>

        <div className="flex flex-col gap-2 px-2 py-3 md:flex-row md:items-center md:px-0">
          <div className="main-toolbar-search group w-full max-w-none md:max-w-[27.5rem] md:flex-1">
            <input type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search Special Orders..." className="main-toolbar-search-input" />
            <div className="main-toolbar-search-icon" aria-hidden="true"><svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
          </div>
          <ToolbarDropdown
            value={statusFilter}
            options={statusOptions.map((status) => ({
              value: status,
              label: status === 'All' ? 'All Statuses' : status,
            }))}
            onChange={setStatusFilter}
            ariaLabel="Filter special orders by status"
            className="w-fit max-w-full self-start md:self-auto"
            menuClassName="w-max min-w-[min(16rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] max-h-[min(50vh,20rem)] overflow-y-auto pr-3 [scrollbar-gutter:stable]"
            compact
            portalMenu
            fitSelectedValue
            softForeground
            focusVisibleRing
          />
          <button type="button" onClick={openCreateForm} className={`${PRIMARY_BUTTON_CLASS} inline-flex self-start items-center justify-center gap-2 whitespace-nowrap md:ml-auto md:self-auto`}>
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
            Create Quotation
          </button>
          {refreshing && !initialLoading && <span className="text-[11px] font-semibold text-gray-500">Refreshing...</span>}
        </div>

        <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none md:rounded-md md:border md:border-gray-100 md:shadow-sm">
          <span role="status" className="sr-only">{detailLoading ? `Loading ${detailLoading.action === 'decide' ? 'customer decision' : 'special order details'} for ${detailLoading.orderNumber}` : ''}</span>
          <div className="flex-1 overflow-y-auto overflow-x-hidden md:overflow-x-auto lg:overflow-x-hidden" aria-busy={initialLoading || refreshing}>
            <div className="flex flex-col gap-3 p-2 md:hidden" aria-label="Special Orders mobile records">
              {isOrderListLoading ? (
                Array.from({ length: 4 }).map((_, index) => <div key={`special-orders-mobile-skeleton-${index}`} className="h-36 animate-pulse rounded-xl border border-slate-200 bg-white" />)
              ) : orders.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
                  <ContextualEmptyState {...orderEmptyState} />
                </div>
              ) : paginatedOrders.map((order) => {
                const summary = summarizeOrder(order);
                const rowActions = buildRowActions(order);
                return (
                  <article key={`mobile-${order._id}`} className="app-dashboard-card-hover rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-all text-sm font-semibold leading-5 text-slate-900">{order.orderNumber}</h3>
                        <p className="mt-0.5 break-words text-xs text-slate-600">{quotationOrderView(order).customerName}</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${getStatusBadgeClass(order.status)}`}>{order.status}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
                      <div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Order Date</dt><dd className="mt-0.5 text-xs text-slate-800">{formatDate(order.createdAt)}</dd></div>
                      <div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Expected Date</dt><dd className="mt-0.5 text-xs text-slate-800">{formatDate(summary.expectedDate)}</dd></div>
                      <div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Items</dt><dd className="mt-0.5 text-xs text-slate-800">{summary.itemCount} item{summary.itemCount === 1 ? '' : 's'}</dd></div>
                      <div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Total Amount</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{formatMoney(summary.total)}</dd></div>
                    </dl>
                    {(order.linkedSaleId || (order.status === 'Pending' && order.quotation?.status)) && <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      {order.linkedSaleId && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-800">Sale Recorded</span>}
                      {order.status === 'Pending' && order.quotation?.status && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-700">{order.quotation.status === 'Awaiting Decision' ? 'Awaiting decision' : order.quotation.status}</span>}
                    </div>}
                    <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                      {renderOrderRowActions(order, rowActions, { mobile: true })}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="hidden md:block">
            <table className="main-data-table w-full min-w-0 table-fixed border-separate border-spacing-0 text-left max-lg:min-w-[760px]">
              <thead className="sticky top-0 z-10 shadow-sm">
                <tr className="bg-gray-900 text-white uppercase tracking-wider">
                  <th className="w-[14%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Reference</th>
                  <th className="w-[13%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Customer</th>
                  <th className="w-[14%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Items</th>
                  <th className="w-[10%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Order Date</th>
                  <th className="w-[10%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Expected Date</th>
                  <th className="w-[9%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Total</th>
                  <th className="w-[10%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Status</th>
                  <th className="w-[20%] border border-gray-700 px-1 py-2 text-center text-[11px] font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {isOrderListLoading ? (
                  <TableSkeletonRows
                    rowKeyPrefix="special-orders-skeleton"
                    columnTypes={['text', 'text', 'text', 'text', 'text', 'text', 'pill', 'actions']}
                  />
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="border border-gray-200 p-2 text-center"><ContextualEmptyState {...orderEmptyState} /></td>
                  </tr>
                ) : paginatedOrders.map((order) => {
                  const summary = summarizeOrder(order);
                  const loadingAction = detailLoading?.orderId === String(order._id) ? detailLoading.action : null;
                  const rowActions = buildRowActions(order);
                  return (
                    <tr
                      key={order._id}
                      role="button"
                      tabIndex={0}
                      aria-label={`View details for special order ${order.orderNumber}`}
                      data-loading={loadingAction !== null}
                      onClick={() => { void openOrderDetails(order); }}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault();
                          void openOrderDetails(order);
                        }
                      }}
                      className={`${getAttentionRowClass(order.status)} cursor-pointer transition-colors duration-150 focus:outline-none`}
                    >
                      <td className="border border-gray-200 px-1.5 py-1.5 text-center"><IdentifierChip className="px-1.5"><span className="min-w-0 break-all">{order.orderNumber}</span></IdentifierChip></td>
                      <td className="truncate border border-gray-200 px-1.5 py-1.5 text-center text-xs font-medium text-gray-800">{quotationOrderView(order).customerName}</td>
                      <td className="border border-gray-200 px-1.5 py-1.5 text-center">
                        <span className="text-xs font-medium text-gray-700">{summary.itemCount} item{summary.itemCount === 1 ? '' : 's'}</span>
                      </td>
                      <td className="whitespace-nowrap border border-gray-200 px-1.5 py-1.5 text-center text-xs font-medium text-gray-700">{formatDate(order.createdAt)}</td>
                      <td className="whitespace-nowrap border border-gray-200 px-1.5 py-1.5 text-center text-xs font-medium text-gray-700">{formatDate(summary.expectedDate)}</td>
                      <td className="whitespace-nowrap border border-gray-200 px-1.5 py-1.5 text-center text-sm font-semibold tabular-nums text-gray-900">{formatMoney(summary.total)}</td>
                      <td className="whitespace-nowrap border border-gray-200 px-1.5 py-1.5 text-center">
                        <div className="flex flex-col items-center leading-tight">
                          <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(order.status)}`}>{order.status}</span>
                          {order.linkedSaleId && <span className="mt-0.5 text-[10px] font-semibold text-slate-700">Sale Recorded</span>}
                          {order.status === 'Pending' && order.quotation?.status && <span title={`Quotation: ${order.quotation.status}`} className="mt-0.5 text-[10px] text-slate-600">{order.quotation.status === 'Awaiting Decision' ? 'Awaiting decision' : order.quotation.status}</span>}
                        </div>
                      </td>
                      <td className="border border-gray-200 px-1 py-1 text-center">
                        <div className="flex min-h-11 items-center justify-center">
                          {renderOrderRowActions(order, rowActions)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          <div className="shrink-0 border-t border-gray-200 bg-slate-200/95 px-4 py-2 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur-sm md:px-6 md:py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium text-gray-500">
                Showing <span className="font-semibold text-gray-900">{displayStart}</span> to <span className="font-semibold text-gray-900">{displayEnd}</span> of <span className="font-semibold text-gray-900">{orders.length}</span> results
              </div>
              <Pagination currentPage={activePage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={itemsPerPage} onPageSizeChange={(pageSize) => { setItemsPerPage(pageSize); setCurrentPage(1); }} />
            </div>
          </div>
        </div>
      </section>

      {showForm && !quickAddCustomerOpen && (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-200" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900">
                  <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold leading-tight text-slate-950">Prepare Quotation</h2>
                  <p className="mt-0.5 text-xs text-slate-600">Prepare a quotation for customer review.</p>
                </div>
              </div>
              <button type="button" onClick={() => closeForm()} disabled={isSubmitting} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Close special order form"><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>

            <form noValidate onSubmit={saveForm} className="flex min-h-0 flex-1 flex-col">
              <div ref={formScrollContainerRef} className="min-h-0 space-y-4 overflow-y-auto bg-slate-50 px-4 py-4 sm:space-y-5 sm:px-5 sm:py-5 [&_input]:border-slate-300 [&_input]:text-sm [&_select]:border-slate-300 [&_select]:text-sm [&_textarea]:border-slate-300 [&_textarea]:text-sm">
                <section className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Customer &amp; Order</h3>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(14rem,0.8fr)]">
                    <div className="min-w-0">
                      <span className={QUOTATION_FIELD_LABEL_CLASS}>Customer <span className="text-rose-700">*</span></span>
                      <CustomerCombobox customerId={form.customerId} query={customerQuery} onQueryChange={setCustomerQuery} customers={customerPartners} loading={isSuppliersLoading} disabled={isSubmitting} error={formErrors.customerName} inputRef={(element) => { formFieldRefs.current.customerName = element; }} onSelect={selectCustomer} canAdd={['admin', 'superadmin'].includes(userRole)} onAdd={(query) => { setQuickAddCustomerName(query); setQuickAddCustomerError(''); customerCreateRequestIdRef.current = ''; setQuickAddCustomerOpen(true); }} />
                      <FieldError id="special-order-customer-error" message={formErrors.customerName} />
                    </div>
                    <label className="block min-w-0"><span className={QUOTATION_FIELD_LABEL_CLASS}>VAT Classification <span className="text-rose-700">*</span></span>
                      <select ref={(element) => { formFieldRefs.current.taxTreatment = element; }} id="special-order-tax-treatment" name="taxTreatment" data-validation-key="taxTreatment" value={form.taxTreatment} disabled={isSubmitting || form.customerVatExempt} aria-invalid={Boolean(formErrors.taxTreatment)} aria-describedby={formErrors.taxTreatment ? 'special-order-tax-treatment-error' : undefined} onChange={(event) => { setForm((previous) => ({ ...previous, taxTreatment: event.target.value })); setFormErrors((previous) => ({ ...previous, taxTreatment: '' })); }} className={getQuotationFormInputClass(formErrors.taxTreatment)}>
                        <option value="">Select classification</option><option value="standard">VAT-Rated</option><option value="vat_zero_rated">VAT Zero-Rated</option>
                      </select><FieldError id="special-order-tax-treatment-error" message={formErrors.taxTreatment} />
                      {form.customerVatExempt && <span className="mt-1 block text-[10px] text-amber-700">VAT-exempt customer quotations are unavailable until their tax treatment is approved.</span>}
                      <span className="mt-1 block text-[10px] text-slate-500">Agreed prices stay unchanged. VAT amount is not calculated.</span>
                    </label>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {[['attentionName', 'ATTN', 'Recipient name (optional)'], ['attentionPosition', 'Position', 'Recipient position (optional)'], ['authorizedSignatoryName', 'Authorized Signatory Name', 'Enter authorized signatory name']].map(([field, label, placeholder]) => (
                      <label key={field}><span className={QUOTATION_FIELD_LABEL_CLASS}>{label}{field === 'authorizedSignatoryName' && <span className="text-rose-700"> *</span>}</span><input ref={(element) => { if (field === 'authorizedSignatoryName') formFieldRefs.current[field] = element; }} id={`special-order-${field}`} name={`quotationDetails.${field}`} data-validation-key={field} value={form.quotationDetails[field]} maxLength={150} disabled={isSubmitting} aria-invalid={Boolean(formErrors[field])} aria-describedby={formErrors[field] ? `special-order-${field}-error` : undefined} placeholder={placeholder} onChange={(event) => { setForm((previous) => ({ ...previous, quotationDetails: { ...previous.quotationDetails, [field]: event.target.value } })); setFormErrors((previous) => ({ ...previous, [field]: '' })); }} className={getQuotationFormInputClass(formErrors[field])} /><FieldError id={`special-order-${field}-error`} message={formErrors[field]} /></label>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Item Details</h3>
                      <p className="mt-0.5 text-xs text-slate-600">{formSummary.itemCount} item{formSummary.itemCount === 1 ? '' : 's'} in this order</p>
                    </div>
                    <button ref={addItemButtonRef} type="button" onClick={addItemRow} disabled={isSubmitting || loadingProductImages} aria-disabled={!canAddAnotherItem || isSubmitting || loadingProductImages} aria-label={canAddAnotherItem ? 'Add Item' : 'Add Item; complete the current item first'} className={`${QUOTATION_FORM_COMPACT_PRIMARY_BUTTON_CLASS}${canAddAnotherItem && !loadingProductImages ? '' : ' cursor-not-allowed opacity-50'}`}>Add Item</button>
                  </div>
                  <fieldset className="space-y-3 disabled:opacity-60" disabled={isSubmitting}>
                    {[...(form.items || [])].reverse().map((item, index) => (
                      <ItemEditor key={item.itemId || item.__rowId} item={item} index={index} itemCount={(form.items || []).length} disabled={isSubmitting} errors={formErrors.items?.[String(item.itemId || item.__rowId)]} registerFieldRef={registerQuotationFormField} suppliers={supplierPartners} isSuppliersLoading={isSuppliersLoading} inventory={inventory} categories={categories} userRole={userRole} expiryBatchInfoByItemId={expiryBatchInfoByItemId} onRetryExpiryInfo={loadExpiryBatchInfo} onChange={updateItemRow} onReplace={replaceItemRow} onSelectInventoryProduct={selectInventoryProductForQuotation} onRemove={requestRemoveItemRow} />
                    ))}
                  </fieldset>
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">Pickup or Delivery</h3>
                  <FulfillmentFields value={form.fulfillment} onChange={(fulfillment) => { setForm((previous) => ({ ...previous, fulfillment })); setFormErrors((previous) => ({ ...previous, fulfillment: '' })); }} disabled={isSubmitting} error={formErrors.fulfillment} />
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">Order Summary</h3>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <label><span className={QUOTATION_FIELD_LABEL_CLASS}>Order notes</span><textarea value={form.remarks} disabled={isSubmitting} onChange={(event) => setForm((previous) => ({ ...previous, remarks: event.target.value }))} rows={2} className={`${QUOTATION_FORM_INPUT_CLASS} h-auto min-h-20 resize-y`} placeholder="Optional notes" /></label>
                    <dl className="grid grid-cols-3 gap-3 rounded-lg bg-white px-3 py-2.5 text-center text-xs text-slate-600 md:min-w-75">
                      <div><dt>Items</dt><dd className="mt-0.5 text-sm font-semibold text-gray-900">{formSummary.itemCount}</dd></div>
                      <div><dt>Total Qty</dt><dd className="mt-0.5 text-sm font-semibold text-gray-900">{formSummary.quantity}</dd></div>
                      <div><dt>Total</dt><dd className="mt-0.5 whitespace-nowrap text-sm font-semibold text-gray-900">{formatMoney(formSummary.total)}</dd></div>
                    </dl>
                  </div>
                </section>
              </div>
              <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
                <button type="submit" disabled={isSubmitting || loadingProductImages} className={`${QUOTATION_FORM_PRIMARY_BUTTON_CLASS} w-full sm:w-auto`}>{isSubmitting ? 'Generating...' : loadingProductImages ? 'Loading Product Images...' : 'Generate Quotation'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showForm && itemRemovalTargetId && (
        <div
          className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={(event) => { if (event.target === event.currentTarget) closeItemRemovalConfirmation(); }}
        >
          <section role="alertdialog" aria-modal="true" aria-labelledby="remove-quotation-item-title" aria-describedby="remove-quotation-item-description" onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="remove-quotation-item-title" className="text-base font-semibold text-slate-950">Remove Item?</h2>
            <p id="remove-quotation-item-description" className="mt-2 text-sm leading-5 text-slate-700">Are you sure you want to remove this item from the quotation?</p>
            {itemRemovalSummary.length > 0 && <dl aria-label="Item selected for removal" className="mt-3 grid max-h-[30vh] grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
              {itemRemovalSummary.map(({ label, value }) => <React.Fragment key={label}><dt className="text-slate-500">{label}</dt><dd className="min-w-0 break-words font-medium text-slate-800">{value}</dd></React.Fragment>)}
            </dl>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button ref={itemRemovalCancelRef} type="button" onClick={closeItemRemovalConfirmation} className={QUOTATION_FORM_SECONDARY_BUTTON_CLASS}>Cancel</button>
              <button type="button" onClick={confirmRemoveItemRow} disabled={isSubmitting} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-rose-700 bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">Remove</button>
            </div>
          </section>
        </div>
      )}

      {showForm && discardConfirmOpen && (
        <div className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="discard-quotation-title" aria-describedby="discard-quotation-description" onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="discard-quotation-title" className="text-base font-semibold text-slate-950">Discard quotation changes?</h2>
            <p id="discard-quotation-description" className="mt-2 text-sm leading-5 text-slate-700">You have unsaved changes. Are you sure you want to close this form and discard them?</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setDiscardConfirmOpen(false)} className={QUOTATION_FORM_SECONDARY_BUTTON_CLASS}>Keep Editing</button>
              <button type="button" onClick={discardQuotationChanges} className={QUOTATION_FORM_PRIMARY_BUTTON_CLASS}>Discard Changes</button>
            </div>
          </section>
        </div>
      )}

      {showForm && quickAddCustomerOpen && (
        <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="special-order-add-customer-title">
          <form onSubmit={saveQuickAddCustomer} onClick={(event) => event.stopPropagation()} className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 id="special-order-add-customer-title" className="text-sm font-semibold text-slate-900">Add Regular Customer</h2>
            <p className="mt-1 text-xs text-slate-500">Only a customer name is required.</p>
            <label htmlFor="special-order-add-customer-name" className="mt-4 block text-xs font-medium text-slate-700">Customer Name</label>
            <input id="special-order-add-customer-name" autoFocus maxLength={120} value={quickAddCustomerName} onChange={(event) => { setQuickAddCustomerName(event.target.value); setQuickAddCustomerError(''); customerCreateRequestIdRef.current = ''; }} aria-invalid={Boolean(quickAddCustomerError)} aria-describedby={quickAddCustomerError ? 'special-order-add-customer-error' : undefined} placeholder="Enter customer name" className={`${INPUT_CLASS} mt-1`} disabled={savingCustomer} />
            {quickAddCustomerError && <p id="special-order-add-customer-error" role="alert" className="mt-2 text-xs text-rose-700">{quickAddCustomerError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={savingCustomer} onClick={closeQuickAddCustomer} className={SECONDARY_BUTTON_CLASS}>Cancel</button>
              <button type="submit" disabled={savingCustomer || !quickAddCustomerName.trim()} className={PRIMARY_BUTTON_CLASS}>{savingCustomer ? 'Saving...' : 'Save Customer'}</button>
            </div>
          </form>
        </div>
      )}

      {selectedOrder && selectedSummary && !quotationEditorOpen && !quotationPreview && !decisionOpen && !paymentOpen && !paymentProofPreview && (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[22px] font-semibold leading-tight text-slate-950">{selectedOrder.orderNumber}</h2>
                  <span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass(selectedOrder.status)}`}>{selectedOrder.status}</span>
                  {selectedOrder.linkedSaleId && <span className="inline-flex rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800">Sale Recorded</span>}
                  {selectedOrder.status === 'Pending' && quotation?.status && <span className="text-[13px] font-medium text-slate-700">Quotation: {quotation.status}</span>}
                </div>
              </div>
              <button type="button" onClick={closeDetails} disabled={Boolean(orderAction)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50" aria-label="Close special order details"><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <dl className="grid gap-x-4 gap-y-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Customer</dt><dd className="mt-0.5 break-words font-semibold text-slate-900">{quotationOrderView(selectedOrder).customerName}</dd></div>
                <div><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Order Date</dt><dd className="mt-0.5 font-medium text-slate-900">{formatDate(selectedOrder.createdAt)}</dd></div>
                {(quotation?.fulfillment || selectedOrder.fulfillment) && <div><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Pickup or Delivery</dt><dd className="mt-0.5 text-slate-900">{fulfillmentDescription(quotation?.fulfillment || selectedOrder.fulfillment)}</dd></div>}
                {selectedSummary.expectedDate && <div><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Expected Date</dt><dd className="mt-0.5 font-medium text-slate-900">{formatDate(selectedSummary.expectedDate)}</dd></div>}
                {!showPaymentSection && <div><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Agreed Total</dt><dd className="mt-0.5 font-semibold text-slate-950">{formatMoney(selectedSummary.total)}</dd></div>}
                {Number(selectedOrder.workflowVersion) >= 2 && <div><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">VAT Classification</dt><dd className="mt-0.5 font-medium text-slate-900">{approvedTaxTreatment ? ({ standard: 'VAT-Rated', vat_zero_rated: 'VAT Zero-Rated' })[approvedTaxTreatment] : 'Needs review'}</dd></div>}
                {selectedOrder.linkedSaleId && <div><dt className="text-[13px] font-medium text-slate-600">Financial Sale</dt><dd className="mt-1 text-sm font-semibold text-slate-900">Recorded{selectedOrder.financialRecordedAt ? ` · ${formatDate(selectedOrder.financialRecordedAt)}` : ''}</dd></div>}
              </dl>
              {showPaymentSection && <section className="mt-3 rounded-xl border border-slate-200 p-3 sm:p-4" aria-label="Special Order Payments">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Payment</h3>
                </div>
                {paymentError && !paymentLedger ? <p role="alert" className="mt-2 text-xs text-rose-700">Payment details could not be loaded. Reload order details to retry.</p> : <dl className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">{paymentSummaryMetrics.map((metric) => <div key={metric.label} className={`p-2.5 ${metric.prominent ? 'bg-amber-50' : 'bg-white'}`}><dt className={`text-[11px] font-medium ${metric.prominent ? 'text-amber-800' : 'text-slate-600'}`}>{metric.label}</dt><dd className={`mt-1 break-words ${metric.prominent ? 'text-base font-bold text-amber-900' : 'text-sm font-semibold text-slate-950'}`}>{metric.label === 'Payment Status' && metric.value === 'Fully Paid' ? <span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass('Completed')}`}>{metric.value}</span> : metric.value}</dd></div>)}</dl>}
                {nextAction?.action === 'record-payment' && <div className="mt-3 flex flex-col gap-2 rounded-lg bg-slate-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-700">{isCreditSpecialOrder ? 'Settle the remaining Credit balance in Credit Transactions.' : 'Settle the remaining Cash balance to continue.'}</p><button type="button" onClick={runNextAction} disabled={Boolean(orderAction) || quotationLoading} className={`${DETAIL_PRIMARY_BUTTON_CLASS} shrink-0`}>{isCreditSpecialOrder ? 'Open Credit Transaction' : paymentLedger ? 'Record Final Payment' : 'Record Down Payment'}</button></div>}
                {paymentLedger && <div className="mt-3 space-y-3">
                  {(paymentLedger.reservationAtPayment || []).some((item) => item.itemType === 'inventory') && <details className="mt-3 border-t border-slate-200 pt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-800">Stock at payment</summary>
                    <p className="mt-2 text-[13px] text-slate-700">{(paymentLedger.reservationAtPayment || []).filter((item) => item.itemType === 'inventory').reduce((sum, item) => sum + item.reservedQuantity, 0)} reserved · {(paymentLedger.reservationAtPayment || []).filter((item) => item.itemType === 'inventory').reduce((sum, item) => sum + item.shortageQuantity, 0)} short at payment</p>
                  </details>}
                  <details className="mt-3 border-t border-slate-200 pt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-800">Payment History <span className="font-normal text-slate-600">({(paymentLedger.payments || []).length})</span></summary>
                    <p className="mt-2 break-all text-xs text-slate-600">Special Order: {selectedOrder.orderNumber}</p>
                    {isCreditSpecialOrder && paymentLedger.creditTransactionId && <p className="break-all text-xs text-slate-600">Credit Transaction: {paymentLedger.creditTransactionId}</p>}
                    <div className="mt-2 divide-y divide-slate-200">{(paymentLedger.payments || []).map((payment) => <article key={payment.requestId} className="grid min-w-0 gap-x-4 gap-y-1 py-3 text-[13px] leading-5 text-slate-700 sm:grid-cols-2">
                      <p className="break-words font-semibold text-slate-900">{payment.type === 'down_payment' ? 'Down Payment' : payment.type === 'final_payment' ? 'Final Payment' : 'Partial Payment'} · {formatMoney(payment.amountCentavos / 100)}</p>
                      <p className="break-words">{formatPaymentMethod(payment.method)}{payment.otherMethod ? ` (${payment.otherMethod})` : ''}</p>
                      <p className="break-words">{new Date(payment.recordedAt).toLocaleString()}</p>
                      {(payment.internalReference || payment.reference) && <p className="break-all">Reference: {payment.internalReference || payment.reference}</p>}
                      {payment.chequeCleared === true && <p>Cheque clearance confirmed</p>}
                      {payment.notes && <p className="whitespace-pre-wrap break-words sm:col-span-2">Notes: {payment.notes}</p>}
                      {(payment.proofs || []).length > 0 && <div className="flex flex-wrap gap-2 sm:col-span-2">{payment.proofs.map((proof, index) => <button key={`${payment.requestId}-${index}`} id={`special-order-payment-proof-${payment.requestId}-${index}`} type="button" title={proof.fileName || `Payment proof ${index + 1}`} onClick={() => { paymentProofTriggerRef.current = `special-order-payment-proof-${payment.requestId}-${index}`; void viewPaymentProof(payment, index); }} className="min-h-9 rounded-md px-2 text-[13px] font-medium text-slate-800 underline underline-offset-2 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700">View proof {index + 1}</button>)}</div>}
                    </article>)}</div>
                  </details>
                  {selectedOrder.status === 'In Progress' && <p className="mt-3 text-[13px] text-amber-800">Paid-order cancellation is temporarily unavailable.</p>}
                </div>}
              </section>}

              {nextAction && nextAction.action !== 'record-payment' && <section aria-label="Next action" aria-live="polite" className={`mt-3 flex flex-col gap-3 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${['complete-order', 'legacy-complete'].includes(nextAction.action) ? 'border-slate-300 bg-slate-100' : 'border-slate-200 bg-slate-50'}`}>
                <div className="min-w-0"><h3 className="text-[15px] font-semibold text-slate-950">{nextAction.title}</h3><p className="mt-1 break-words text-sm leading-5 text-slate-700">{nextAction.detail}</p></div>
                {nextAction.action && <button type="button" onClick={runNextAction} disabled={Boolean(orderAction) || quotationLoading || (nextAction.action === 'complete-order' && stockLoading)} className={`${nextAction.secondary ? DETAIL_SECONDARY_BUTTON_CLASS : DETAIL_PRIMARY_BUTTON_CLASS} ${['complete-order', 'legacy-complete'].includes(nextAction.action) ? 'shrink-0 whitespace-nowrap self-end sm:self-auto' : ''}`}>{nextAction.action === 'reload' ? 'Reload Details' : nextAction.action === 'decision' ? 'Record Decision' : nextAction.action === 'generate-quotation' ? 'Generate Quotation' : nextAction.action === 'prepare-quotation' ? 'Prepare Quotation' : ['complete-order', 'legacy-complete'].includes(nextAction.action) ? 'Complete Order' : 'View Preparation'}</button>}
              </section>}

              {Number(selectedOrder.workflowVersion) >= 2 && <section id="special-order-preparation" className="border-t border-slate-200 py-4" aria-busy={stockLoading}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div><h3 className="text-sm font-semibold text-slate-900">Inventory Availability</h3>{inventoryPreparationItems.length > 0 && <p className="mt-0.5 text-xs text-slate-700">{inventoryPreparationItems.filter((item) => !item.reservationNeedsReview && Number(item.shortage || 0) === 0).length} of {inventoryPreparationItems.length} inventory SKUs available or reserved</p>}</div>
                  {showStockRefresh && <button type="button" onClick={() => { void refreshStockAvailability(); }} disabled={stockLoading || Boolean(orderAction)} className={DETAIL_SECONDARY_BUTTON_CLASS}>Refresh Stock</button>}
                </div>
                {stockAvailability?.fulfillment && inventoryPreparationItems.length > 0 && <p className="mb-3 text-sm text-slate-800"><span className="font-semibold">{stockAvailability.fulfillment.status}</span>{stockAvailability.fulfillment.readyConfirmedAt && <span className="text-slate-700"> · Previously confirmed {new Date(stockAvailability.fulfillment.readyConfirmedAt).toLocaleString()}</span>}</p>}
                {stockLoading && <p role="status" className="text-sm text-slate-700">Checking current stock…</p>}
                <div className="space-y-3">
                  {!stockLoading && !stockError && inventoryPreparationItems.length === 0 && <p className="text-sm text-slate-700">No stock handling required.</p>}
                  {inventoryPreparationItems.map((item, index) => {
                    const ordered = Number(item.orderedQuantity || 0);
                    const reserved = Number(item.allocatedToOrder || 0);
                    const shortage = Math.max(0, Number(item.shortage || 0));
                    const stockStatus = Number(item.consumedQuantity || 0) >= ordered
                      ? 'Consumed' : item.reservationNeedsReview ? 'Needs Review' : shortage === 0 ? 'Stock Available' : reserved > 0 ? 'Partially Reserved' : 'Insufficient Stock';
                    return <div key={item.productId || item.itemId || index} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <p className="min-w-0 break-words font-semibold text-slate-950">{item.itemName}{item.sku ? <span className="ml-2 break-all text-[13px] font-medium text-slate-700">{item.sku}</span> : ''}</p>
                      <span className={`text-[13px] font-semibold ${stockStatus === 'Stock Available' || stockStatus === 'Consumed' ? 'text-emerald-800' : stockStatus === 'Partially Reserved' || stockStatus === 'Needs Review' ? 'text-amber-800' : 'text-slate-700'}`}>{stockStatus}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-800">Ordered: <strong>{ordered}</strong> · Reserved: <strong>{reserved} of {ordered}</strong> · Shortage: <strong>{shortage}</strong></p>
                    <>
                      <details className="mt-3 text-[13px] text-slate-700">
                        <summary className="w-fit cursor-pointer select-none font-medium">View Stock Details</summary>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-1">
                          <span>Physical Stock: {item.physicalStock}</span>
                          <span>Available to Sell: {item.availableToSell}</span>
                          <span>Reserved Overall: {item.reservedTotal}</span>
                          <span>Shortage: {item.shortage}</span>
                        </div>
                      </details>
                      {item.expiryTrackingEnabled && item.reservedBatchAllocations?.length > 0 && <div className="mt-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700">
                        <p className="font-semibold text-slate-800">Reserved batch picks</p>
                        <ul className="mt-1 space-y-0.5">{item.reservedBatchAllocations.map((batch) => <li key={`${item.productId}-${batch.batch}`} className="break-words"><span className="font-medium">Batch Reference: {batch.batchReference || 'Reference pending'}</span>{batch.lotNumber ? ` · Manufacturer Lot: ${batch.lotNumber}` : ''} · Exp {batch.expiryDate} · {batch.quantity} {item.sellingUnit || 'unit(s)'}</li>)}</ul>
                      </div>}
                      {selectedOrder.status === 'In Progress' && !item.reservable && !item.reservationNeedsReview && <p className="mt-1 text-amber-700">SKU inactive; new reservations unavailable.</p>}
                      {item.reservationNeedsReview && <p className="mt-1 text-amber-700">Reservation needs review before completion.</p>}
                    </>
                  </div>;
                  })}
                </div>
                {canProcessSpecialOrder && selectedOrder.status === 'In Progress' && quotation?.status === 'Accepted' && <div className="mt-3 flex flex-wrap gap-2">
                  {stockAvailability?.items?.some((item) => item.itemType === 'inventory' && item.reservable && item.unreservedQuantity > 0) && <button type="button" onClick={() => { void performStockAction('Reserve'); }} disabled={Boolean(orderAction) || stockLoading || !stockAvailability?.items?.some((item) => item.itemType === 'inventory' && item.reservable && item.unreservedQuantity > 0 && item.availableToSell > 0)} className={DETAIL_PRIMARY_BUTTON_CLASS}>Reserve Available Stock</button>}
                  {canManageOrderExceptions && !paymentLedger && <button type="button" onClick={() => { void performStockAction('Release'); }} disabled={Boolean(orderAction) || stockLoading || !stockAvailability?.items?.some((item) => item.allocatedToOrder > 0)} className={DETAIL_SECONDARY_BUTTON_CLASS}>Release Reservation</button>}
                </div>}
              </section>}

              <details className="border-t border-slate-200 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">Ordered Items &amp; Specifications <span className="font-normal text-slate-600">({selectedSummary.itemCount})</span></summary>
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(5rem,.7fr)_minmax(3rem,.4fr)_minmax(6rem,.8fr)_minmax(6rem,.8fr)] gap-3 border-b border-slate-300 bg-slate-100 px-3 py-2 text-[13px] font-semibold text-slate-800 sm:grid">
                    <span>Item</span><span>Unit</span><span>Qty</span><span>Unit Price</span><span>Amount</span>
                  </div>
                  <div className="divide-y divide-gray-200">
                    {selectedSummary.items.map((item, index) => (
                      <div key={`${selectedOrder._id}-item-${index}`} className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-200 px-3 py-3 text-sm first:border-t-0 sm:grid-cols-[minmax(0,1.7fr)_minmax(5rem,.7fr)_minmax(3rem,.4fr)_minmax(6rem,.8fr)_minmax(6rem,.8fr)] sm:gap-3">
                        <span className="col-span-2 min-w-0 sm:col-span-1"><span className="block break-words font-medium text-slate-950">{item.itemName}</span>{item.inventorySnapshot?.sku && <span className="mt-1 block break-all text-[13px] text-slate-700">SKU: {item.inventorySnapshot.sku}</span>}{item.description && <span className="mt-1 block break-words text-[13px] leading-5 text-slate-700">{item.description}</span>}{item.priceOverrideReason && <span className="mt-1 block break-words text-[13px] text-slate-700">Price adjusted: {formatMoney(item.originalUnitPrice)} → {formatMoney(item.sellingPrice)} · {item.priceOverrideReason}</span>}</span>
                        <span><span className="block text-[13px] font-medium text-slate-600 sm:hidden">Selling Unit</span><span className="text-sm text-slate-800">{item.sellingUnit || '-'}</span></span><span><span className="block text-[13px] font-medium text-slate-600 sm:hidden">Quantity</span><span className="text-sm text-slate-900">{Number(item.quantity || 0)}</span></span><span><span className="block text-[13px] font-medium text-slate-600 sm:hidden">Unit Price</span><span className="text-sm text-slate-800">{formatMoney(item.sellingPrice)}</span></span><span><span className="block text-[13px] font-medium text-slate-600 sm:hidden">Amount</span><span className="text-sm font-semibold text-slate-900">{formatMoney(item.lineAmount ?? Number(item.sellingPrice || 0) * Number(item.quantity || 0))}</span></span>
                        {(item.remarks || item.expectedArrivalDate) && <span className="col-span-2 break-words text-[13px] leading-5 text-slate-700 sm:col-span-5">{item.expectedArrivalDate ? `Expected ${formatDate(item.expectedArrivalDate)}` : ''}{item.expectedArrivalDate && item.remarks ? ' / ' : ''}{item.remarks || ''}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </details>
              {(selectedOrder.remarks || selectedOrder.cancelledReason) && <section className="border-t border-slate-200 py-3">
                <h3 className="text-[15px] font-semibold text-slate-900">Order Notes</h3>
                {selectedOrder.remarks && <p className="mt-1 break-words text-sm leading-5 text-slate-800">{selectedOrder.remarks}</p>}
                {selectedOrder.cancelledReason && <p className="mt-2 break-words text-sm leading-5 text-slate-800">Decline reason: {selectedOrder.cancelledReason}</p>}
              </section>}
              <details className="border-t border-slate-200 py-3" aria-busy={quotationLoading}>
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">Quotation History <span className="font-normal text-slate-600">({quotationHistory.length})</span></summary>
                <div className="mt-2 space-y-2">
                {quotationLoading && <p role="status" className="text-sm text-slate-700">Loading quotations…</p>}
                {!quotationLoading && quotationHistory.length === 0 && <p className="text-sm text-slate-700">No quotation recorded. Prepare a quotation to continue.</p>}
                {quotationHistory.map((version) => (
                  <details key={version._id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <summary className="cursor-pointer break-words text-sm font-semibold text-slate-900">{version.quotationNumber} · v{version.version} · {version.status}{version.isCurrent ? ' · Current' : ' · Historical'}</summary>
                    <div className="mt-3 space-y-2 text-[13px] leading-5 text-slate-700">
                      <p className="font-medium">{version.customerName}{version.customerDetails?.address ? ` · ${version.customerDetails.address}` : ''}</p>
                      {version.fulfillment?.method && <p>Pickup or Delivery: {fulfillmentDescription(version.fulfillment)}</p>}
                      {version.issuedAt && <p>Generated: {new Date(version.issuedAt).toLocaleString()} · {version.issuedBy?.displayName || version.issuedBy?.name || String(version.issuedBy || '—')}</p>}
                      {version.decision && <p>Customer decision: {version.decision} · {version.decidedAt ? new Date(version.decidedAt).toLocaleString() : '—'} · {version.decidedBy?.displayName || version.decidedBy?.name || String(version.decidedBy || '—')}</p>}
                      {!version.isCurrent && version.decision === 'Accepted' && <p className="text-amber-700">Historical acceptance does not authorize the current revision.</p>}
                      <div className="space-y-1 border-t border-slate-200 pt-2">{version.items.map((item, index) => <p key={index} className="break-words">{item.itemName}{item.description ? ` — ${item.description}` : ''} · {item.quantity} {item.sellingUnit || ''} × {formatMoney(item.unitPrice)} = {formatMoney(item.lineAmount)}</p>)}</div>
                      <p className="font-semibold text-slate-950">Total: {formatMoney(version.total)}</p>
                      {version.status !== 'Draft' && <button type="button" onClick={() => openQuotationPreview(version)} disabled={quotationBusy} className={SECONDARY_BUTTON_CLASS}>View Quotation / Download PDF</button>}
                    </div>
                  </details>
                ))}
                </div>
              </details>
            </div>
            {hasDetailsFooterActions && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              {selectedOrder.status === 'Completed' && <>
                <button type="button" onClick={() => downloadSpecialOrderPdf(selectedOrder)} disabled={quotationBusy} className={DETAIL_SECONDARY_BUTTON_CLASS}>Download Transaction PDF</button>
                {Number(selectedOrder.workflowVersion) >= 2 && selectedOrder.fulfillmentHandover?.confirmedAt && <span className="self-center text-xs font-medium text-slate-700">{selectedOrder.fulfillmentHandover.status} · {new Date(selectedOrder.fulfillmentHandover.confirmedAt).toLocaleString()}</span>}
              </>}
              {selectedOrder.linkedSaleId && selectedOrder.status !== 'Completed' && <>
                <button type="button" onClick={() => downloadSpecialOrderPdf(selectedOrder)} disabled={quotationBusy} className={DETAIL_SECONDARY_BUTTON_CLASS}>Download Transaction PDF</button>
              </>}
              {quotationActions.edit && <button type="button" onClick={() => openQuotationEditor()} disabled={quotationBusy || Boolean(quotationError)} className={DETAIL_SECONDARY_BUTTON_CLASS}>Edit Draft</button>}
              {quotation && quotation.status !== 'Draft' && <button type="button" onClick={() => openQuotationPreview()} disabled={quotationBusy} className={DETAIL_PRIMARY_BUTTON_CLASS}>{quotationActions.complete ? 'View Accepted Quotation' : 'View Quotation'}</button>}
              {quotationActions.revise && <button type="button" onClick={() => { void reviseQuotation(); }} disabled={quotationBusy || Boolean(quotationError)} className={DETAIL_SECONDARY_BUTTON_CLASS}>Edit Quotation</button>}
              {canManageOrderExceptions && Number(selectedOrder.workflowVersion) >= 2 && selectedOrder.status === 'In Progress' && !paymentLedger && !paymentError && <button type="button" onClick={() => setCancelOrderOpen(true)} disabled={quotationBusy} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2 disabled:opacity-50">Cancel Order</button>}
            </div>}
          </div>
        </div>
      )}

      {paymentOpen && selectedOrder && quotation && <div className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="special-order-payment-title">
        <div data-validation-scope="special-order-payment" className="flex max-h-[92vh] w-full max-w-[30rem] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <header className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
            <div>
              <h2 id="special-order-payment-title" className="text-xl font-semibold text-slate-900">{paymentLedger ? 'Final Payment' : 'Record Down Payment'}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{selectedOrder.orderNumber} · {paymentLedger?.paymentPlan || paymentForm.paymentPlan} · {paymentLedger ? 'Final Payment' : 'Down Payment'}</p>
            </div>
            <button type="button" onClick={() => { setPaymentOpen(false); setPaymentError(''); }} disabled={Boolean(orderAction)} className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Close payment dialog">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            <div className="space-y-4 text-xs text-slate-600 sm:text-[13px]">
              <p>{paymentLedger ? 'Settle the remaining balance to complete this payment stage.' : `Approved quotation total: ${formatMoney(quotation.total)}. Record a confirmed collection only.${!customOnlyQuotation ? ' Available inventory stock will be reserved.' : ''}`}</p>
              {!paymentLedger && <section>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Payment Plan</p>
                <div role="group" aria-label="Payment Plan" className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-100 p-1">
                  {['cash', 'credit'].map((plan) => <button key={plan} type="button" onClick={() => setPaymentForm((previous) => ({ ...previous, paymentPlan: plan }))} disabled={Boolean(orderAction)} aria-pressed={paymentForm.paymentPlan === plan} className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${paymentForm.paymentPlan === plan ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{plan === 'cash' ? 'Cash' : 'Credit'}</button>)}
                </div>
              </section>}
              {!paymentLedger && <label className="block text-xs font-medium text-slate-600">Down Payment Percentage
                <div className="relative mt-1.5">
                  <input type="number" inputMode="decimal" min="0.01" max="100" step="0.01" name="downPaymentPercentage" data-validation-key="downPaymentPercentage" value={paymentForm.downPaymentPercentage} onChange={(event) => {
                    const downPaymentPercentage = event.target.value;
                    setPaymentForm((previous) => ({ ...previous, downPaymentPercentage, amount: getSpecialOrderDownPaymentInput(quotation.total, downPaymentPercentage) }));
                  }} disabled={Boolean(orderAction)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 pr-9 text-right text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50" aria-label="Down Payment Percentage" />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">%</span>
                </div>
              </label>}
              <label className="block text-xs font-medium text-slate-600">{paymentLedger ? 'Final Payment Amount' : 'Required Down Payment'}
                <input type="text" inputMode="decimal" value={paymentForm.amount} placeholder="0.00" readOnly disabled={Boolean(orderAction)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-right text-sm font-semibold tabular-nums text-slate-900 disabled:cursor-not-allowed disabled:opacity-50" aria-label={paymentLedger ? 'Final Payment Amount' : 'Required Down Payment'} />
              </label>
              <section aria-label="Payment summary" className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3.5">
                <div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-500">Order Total</span><span className="text-base font-semibold tabular-nums text-slate-900">{formatMoney(quotation.total)}</span></div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2"><span className="font-medium text-slate-500">Down Payment</span><span className="font-semibold tabular-nums text-slate-900">{Number.isSafeInteger(paymentSummaryDownPaymentCentavos) ? formatMoney(paymentSummaryDownPaymentCentavos / 100) : '—'}</span></div>
                <div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-500">Remaining Balance</span><span className="font-semibold tabular-nums text-slate-900">{Number.isSafeInteger(paymentSummaryRemainingCentavos) ? formatMoney(paymentSummaryRemainingCentavos / 100) : '—'}</span></div>
              </section>
              <label className="block text-xs font-medium text-slate-600">{paymentLedger ? 'Final Payment Method' : 'Down Payment Method'}
                <select name="method" data-validation-key="method" data-validation-aliases="paymentMethod" value={paymentForm.method} onChange={(event) => setPaymentForm((previous) => ({ ...previous, method: event.target.value, chequeCleared: false }))} disabled={Boolean(orderAction)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50">{[['cash', 'Cash'], ['gcash', 'GCash'], ['cheque', 'Cheque'], ['bank transfer', 'Bank Transfer'], ['other', 'Other']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </label>
              {!paymentLedger && paymentForm.paymentPlan === 'credit' && <div>
                <label htmlFor="special-order-credit-term-days" className="block text-xs font-medium text-slate-600">Credit Term (Days)</label>
                <div className="mt-1.5 grid w-full grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] gap-2">
                  <button
                    type="button"
                    onClick={decrementSpecialOrderCreditTerm}
                    disabled={Boolean(orderAction) || !isWholeNumberInput(paymentForm.termDays, { min: SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS, max: SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS }) || Number(paymentForm.termDays) <= SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS}
                    className="flex h-10 w-full items-center justify-center rounded-lg border border-slate-300 bg-white text-lg font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Decrease credit term by one day"
                  >
                    &minus;
                  </button>
                  <input
                    id="special-order-credit-term-days"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    name="termDays"
                    data-validation-key="termDays"
                    value={paymentForm.termDays}
                    onKeyDown={preventInvalidWholeNumberKeyDown}
                    onPaste={preventInvalidWholeNumberPaste}
                    onChange={(event) => handleSpecialOrderCreditTermChange(event.target.value)}
                    disabled={Boolean(orderAction)}
                    className="h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-center text-sm font-semibold leading-10 text-slate-900 focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={incrementSpecialOrderCreditTerm}
                    disabled={Boolean(orderAction) || (paymentForm.termDays !== '' && !isWholeNumberInput(paymentForm.termDays, { min: SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS, max: SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS })) || (isWholeNumberInput(paymentForm.termDays, { min: SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS, max: SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS }) && Number(paymentForm.termDays) >= SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS)}
                    className="flex h-10 w-full items-center justify-center rounded-lg border border-slate-900 bg-slate-900 text-lg font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Increase credit term by one day"
                  >
                    +
                  </button>
                </div>
                <span className="mt-1 block text-[11px] font-normal text-slate-500">Choose 1–60 days. The remaining balance will be managed in Credit Transactions.</span>
              </div>}
              {paymentForm.method === 'other' && <label className="block text-xs font-medium text-slate-600">Other Payment Method
                <input type="text" maxLength={80} name="otherMethod" data-validation-key="otherMethod" data-validation-aliases="paymentMethodOther" value={paymentForm.otherMethod} onChange={(event) => setPaymentForm((previous) => ({ ...previous, otherMethod: event.target.value }))} disabled={Boolean(orderAction)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50" />
              </label>}
              {paymentForm.method === 'cheque' && <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" name="chequeCleared" data-validation-key="chequeCleared" checked={paymentForm.chequeCleared} onChange={(event) => setPaymentForm((previous) => ({ ...previous, chequeCleared: event.target.checked }))} disabled={Boolean(orderAction)} className="mt-0.5 h-4 w-4 accent-slate-900" /><span>I confirm this cheque has cleared.</span></label>}
              {paymentForm.method === 'cash'
                ? <p className="text-xs text-slate-500">Payment reference will be generated automatically.</p>
                : <label className="block text-xs font-medium text-slate-600">Payment Reference (or upload proof)
                <input type="text" maxLength={150} name="reference" data-validation-key="reference" data-validation-aliases="paymentReference" value={paymentForm.reference} placeholder="Enter payment reference" onChange={(event) => setPaymentForm((previous) => ({ ...previous, reference: event.target.value }))} disabled={Boolean(orderAction)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50" />
                </label>}
              <label className="block text-xs font-medium text-slate-600">Payment Notes (Optional)
                <textarea rows={2} maxLength={500} name="paymentNotes" data-validation-key="paymentNotes" value={paymentForm.notes} placeholder="Add payment details or remarks..." onChange={(event) => setPaymentForm((previous) => ({ ...previous, notes: event.target.value }))} disabled={Boolean(orderAction)} className="mt-1.5 min-h-[5rem] w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50" />
              </label>
              {finalCustomPayment && <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5"><p className="text-xs text-slate-700">The Sale will be recorded with this final payment. Provide an Invoice No. or Supporting Document.</p><label className="block text-xs font-medium text-slate-600">Invoice No.
                <input type="text" inputMode="numeric" pattern="[0-9]*" name="invoiceNumber" data-validation-key="invoiceNumber" value={paymentForm.invoiceNumber} placeholder="Enter invoice number" onChange={(event) => setPaymentForm((previous) => ({ ...previous, invoiceNumber: normalizeTransactionReferenceInput(event.target.value) }))} disabled={Boolean(orderAction)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50" />
              </label><EvidenceUploadField id="special-order-final-sale-document" label="Supporting Document" files={paymentForm.saleDocuments} onChange={(saleDocuments) => setPaymentForm((previous) => ({ ...previous, saleDocuments }))} maxFiles={1} uploadPresentation="dashed" uploadLabel="Add Photo" disabled={Boolean(orderAction)} validationKey="saleDocuments" validationAliases="supportingDocuments" /></section>}
              <EvidenceUploadField id="special-order-down-payment-proofs" label="Payment Proof Photos" files={paymentForm.proofs} onChange={(proofs) => setPaymentForm((previous) => ({ ...previous, proofs }))} maxFiles={3} uploadPresentation="dashed" uploadLabel="Add Photo" disabled={Boolean(orderAction)} validationKey="proofs" validationAliases="proofFiles paymentProofs" />
              {paymentError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{paymentError}</p>}
            </div>
          </div>
          <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:p-4">
            <button type="button" onClick={() => { setPaymentOpen(false); setPaymentError(''); }} disabled={Boolean(orderAction)} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Cancel</button>
            <button type="button" data-validation-submit onClick={() => { void recordPayment(); }} disabled={Boolean(orderAction)} className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{orderAction === 'record-payment' ? 'Recording…' : 'Confirm Payment'}</button>
          </footer>
        </div>
      </div>}

      {paymentProofPreview && <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Payment proof preview"><div className="max-w-4xl" onClick={(event) => event.stopPropagation()}><img src={paymentProofPreview.url} alt={paymentProofPreview.name} className="max-h-[80vh] max-w-full rounded bg-white object-contain" /><button ref={paymentProofCloseRef} type="button" onClick={() => setPaymentProofPreview(null)} className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus-visible:ring-2 focus-visible:ring-white">Close</button></div></div>}

      {completionConfirmOpen && selectedOrder && <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="presentation">
        <section role="alertdialog" aria-modal="true" aria-labelledby="complete-special-order-title" aria-describedby="complete-special-order-description" onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
          <h2 id="complete-special-order-title" className="text-base font-semibold text-slate-950">Complete Special Order?</h2>
          <p id="complete-special-order-description" className="mt-2 text-sm leading-5 text-slate-700">This will record the sale if needed, update applicable inventory, and mark the order as Completed.</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button ref={completionConfirmCancelRef} type="button" onClick={closeCompletionConfirmation} disabled={Boolean(orderAction)} className={DETAIL_SECONDARY_BUTTON_CLASS}>Cancel</button>
            <button type="button" onClick={() => { void confirmCompletion(); }} disabled={Boolean(orderAction)} className={DETAIL_PRIMARY_BUTTON_CLASS}>{orderAction === 'complete-order' ? 'Completing…' : 'Confirm Completion'}</button>
          </div>
        </section>
      </div>}

      {cancelOrderOpen && selectedOrder && <div className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-stock-order-title">
        <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
          <h2 id="cancel-stock-order-title" className="text-base font-semibold text-slate-900">Cancel Special Order</h2>
          <p className="mt-2 text-xs text-slate-600">This closes the order and releases its active stock reservations. Physical stock does not change.</p>
          <label className="mt-3 block"><span className={LABEL_CLASS}>Reason (Required)</span><textarea value={cancelOrderReason} onChange={(event) => setCancelOrderReason(event.target.value)} maxLength={500} rows={3} className={INPUT_CLASS} /></label>
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setCancelOrderOpen(false)} disabled={Boolean(orderAction)} className={SECONDARY_BUTTON_CLASS}>Back</button><button type="button" onClick={() => { void performStockAction('Cancel', cancelOrderReason).then(() => { if (!stockActionRequestRef.current) setCancelOrderOpen(false); }); }} disabled={Boolean(orderAction) || !cancelOrderReason.trim()} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-800 focus-visible:ring-2 focus-visible:ring-rose-800 disabled:opacity-50">Confirm Cancellation</button></div>
        </div>
      </div>}

      {decisionOpen && selectedOrder && quotation && (
        <div className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="quotation-decision-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h2 id="quotation-decision-title" className="text-base font-semibold text-gray-900">Record Customer Decision</h2>
            <p className="mt-2 text-xs text-gray-600">{quotation.quotationNumber} · {quotation.customerName}</p>
            <p className="mt-2 text-xs text-gray-500">Confirm the customer's final response. Acceptance activates processing; decline cancels the request. Neither creates a sale. This decision locks editing and revisions.</p>
            <label className="mt-3 block"><span className={LABEL_CLASS}>Decline reason (Optional)</span><textarea value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} disabled={Boolean(orderAction)} rows={2} placeholder="Enter the reason for declining the quotation (optional)..." className={INPUT_CLASS} /></label>
            {quotationError && <p role="alert" className="mt-2 text-xs text-rose-600">{quotationError}</p>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setDecisionOpen(false)} disabled={Boolean(orderAction)} className={SECONDARY_BUTTON_CLASS}>Cancel</button>
              <button type="button" onClick={() => { void recordQuotationDecision('Declined'); }} disabled={Boolean(orderAction)} className={SECONDARY_BUTTON_CLASS}>Record Declined</button>
              <button type="button" onClick={() => { void recordQuotationDecision('Accepted'); }} disabled={Boolean(orderAction)} className={PRIMARY_BUTTON_CLASS}>Record Accepted</button>
            </div>
          </div>
        </div>
      )}

      {quotationEditorOpen && quotationDraft && quotation && selectedOrder && (
        <SpecialOrderQuotationEditor quotation={quotation} draft={quotationDraft} onChange={setQuotationDraft} onClose={closeQuotationEditor} onSave={saveQuotationDraft} onUploadImages={uploadQuotationImages} onReplaceImage={(itemId, imageKey, file) => uploadQuotationImages(itemId, [file], imageKey)} onRemoveImage={removeQuotationImage} onGetImage={(itemId, imageKey) => getSpecialOrderQuotationImageApi(selectedOrder._id, quotation._id, itemId, imageKey)} inventory={inventory} userRole={userRole} phaseOne={Number(selectedOrder.workflowVersion) >= 2} busy={Boolean(orderAction)} error={quotationError} />
      )}

      {quotationPreview && <FormalPriceQuotationModal quotation={quotationPreview} allowPrint={false} onClose={() => setQuotationPreview(null)} />}
      {completedTransactionPreview && !supportingImage && <SpecialOrderTransactionDetailsModal order={completedTransactionPreview.order} transaction={completedTransactionPreview.receiptTransaction} inventory={inventory} categories={categories} onClose={closeCompletedPreview} onViewSupportingImage={previewSupportingImage} imageLoading={imageLoading} imageError={imageError} statusBadgeClass={getStatusBadgeClass} />}
      {supportingImage && <div className="app-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <section role="dialog" aria-modal="true" aria-labelledby="supporting-image-title" onClick={(event) => event.stopPropagation()} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <header className="flex items-center justify-between gap-3 border-b border-gray-100 p-4"><h2 id="supporting-image-title" className="text-sm font-semibold">Supporting Image Preview</h2><button type="button" onClick={() => setSupportingImage(null)} className={SECONDARY_BUTTON_CLASS}>Close Preview</button></header>
          <div className="min-h-0 overflow-auto p-4"><img src={supportingImage.url} alt={supportingImage.name} className="mx-auto max-h-[70dvh] max-w-full object-contain" onError={() => { setImageError('The saved supporting image could not be displayed.'); setSupportingImage(null); }} /></div>
        </section>
      </div>}

      {postSaleFlow?.phase === 'confirmation' && (
        <OrderConfirmationModal
          order={postSaleFlow.order}
          transaction={postSaleFlow.transaction}
          pending={postSaleFlow.order.status !== 'Completed'}
          backLabel="Back to Special Orders"
          onBack={() => {
            void openOrderDetails(postSaleFlow.order, { fromConfirmation: true });
          }}
          onContinue={continueToTransactionReference}
        />
      )}

      {postSaleFlow?.phase === 'batch-verification' && (
        <ExpiryBatchVerificationModal
          title="Verify Special Order Batches"
          items={postSaleFlow.batchItems || []}
          records={postSaleFlow.batchVerificationRecords || {}}
          busy={Boolean(orderAction)}
          onRecordChange={(productId, record) => setPostSaleFlow((previous) => previous ? {
            ...previous,
            batchVerificationRecords: { ...(previous.batchVerificationRecords || {}), [productId]: record },
          } : previous)}
          onBack={() => {
            const order = postSaleFlow.order;
            setPostSaleFlow(null);
            void openOrderDetails(order);
          }}
          onContinue={() => {
            const items = postSaleFlow.batchItems || [];
            const records = postSaleFlow.batchVerificationRecords || {};
            if (!items.every((item) => isExpiryBatchVerificationConfirmed(item, records[item.productId]))) return;
            const batchVerifications = items.map((item) => {
              const record = records[item.productId];
              return {
                productId: item.productId,
                proposedAllocations: record.proposedAllocations,
                verifiedAllocations: record.allocations,
                reason: String(record.reason || '').trim(),
                productStock: item.productStock,
                productReserved: item.productReserved,
              };
            });
            if (postSaleFlow.existingSale) {
              void completeSpecialOrderWithoutNewReference(postSaleFlow.order, postSaleFlow.quotation, batchVerifications);
              return;
            }
            setPostSaleFlow((previous) => previous ? { ...previous, phase: 'reference', batchVerifications } : previous);
          }}
        />
      )}

      {postSaleFlow?.phase === 'reference' && (
        <TransactionReferenceModal
          initialDraft={postSaleFlow.referenceDraft}
          onDraftChange={(referenceDraft) => setPostSaleFlow((previous) => previous ? { ...previous, referenceDraft } : previous)}
          onBack={() => {
            if (postSaleFlow.completionFlow) {
              const order = postSaleFlow.order;
              completionActionRef.current = null;
              setPostSaleFlow(null);
              void openOrderDetails(order);
            } else setPostSaleFlow((previous) => previous ? { ...previous, phase: 'confirmation' } : previous);
          }}
          backLabel={postSaleFlow.completionFlow ? 'Back to Details' : 'Back to Confirmation'}
          requiredFlow
          saveLabel={postSaleFlow.completionFlow ? 'Complete Order' : 'Save Transaction'}
          failureMessage="The transaction was not saved. Check your connection and try again."
          onSave={finalizePostSaleFlow}
          onSaved={finishPostSaleFlow}
        />
      )}
    </div>
  );
};

export default SpecialOrders;
