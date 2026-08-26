import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Pagination from '../components/Pagination';
import IdentifierChip from '../components/IdentifierChip';
import EditIcon from '../components/EditIcon';
import ToolbarDropdown from '../components/ToolbarDropdown';
import { showToast } from '../utils/toastHelper';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import {
  completeSpecialOrderApi,
  createSpecialOrderApi,
  listSpecialOrdersApi,
  updateSpecialOrderApi,
} from '../services/inventoryApi';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { formatCurrency } from '../utils/numberFormat';
import {
  formatMoneyInput,
  isMoneyInput,
  isMoneyInputTooLarge,
  isWholeNumberInput,
  preventInvalidMoneyKeyDown,
  preventInvalidMoneyPaste,
  preventInvalidWholeNumberKeyDown,
  preventInvalidWholeNumberPaste,
  sanitizeMoneyInput,
  sanitizeWholeNumberInput,
} from '../utils/numericInput';

const statusOptions = ['All', 'In Progress', 'Completed'];
const SPECIAL_ORDERS_PER_PAGE = 15;
const INPUT_CLASS = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-gray-900 focus:bg-white focus:ring-0';
const LABEL_CLASS = 'mb-0.5 block text-[11px] font-semibold text-gray-600';
const PRIMARY_BUTTON_CLASS = 'rounded-lg border-2 border-gray-900 bg-gray-900 px-3 py-2 text-xs font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';
const SECONDARY_BUTTON_CLASS = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';

const getInputClass = (hasError) => `${INPUT_CLASS}${hasError ? ' border-red-500 bg-red-50 focus:border-red-600 focus:bg-white' : ''}`;

const getTodayInputDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  itemName: '',
  description: '',
  quantity: 1,
  supplierName: '',
  purchaseCost: '',
  sellingPrice: '',
  expectedArrivalDate: '',
  remarks: '',
  ...item,
});

const createEmptyForm = () => ({
  customerName: '',
  remarks: '',
  items: [createFormItem()],
});

const formatMoney = formatCurrency;

const formatDate = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleDateString();
};

const getStatusBadgeClass = (status) => {
  if (status === 'Completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'In Progress') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-gray-200 bg-gray-100 text-gray-600';
};

const canEditSpecialOrder = (order) => order?.status === 'In Progress';

const getOrderItems = (order) => {
  if (Array.isArray(order?.items) && order.items.length > 0) return order.items;
  if (!order) return [];
  return [{
    itemName: order.itemName || '',
    description: order.description || '',
    quantity: Number(order.quantity || 0),
    supplierName: order.supplierName || '',
    purchaseCost: order.purchaseCost ?? 0,
    sellingPrice: order.sellingPrice ?? 0,
    expectedArrivalDate: order.expectedArrivalDate || null,
    remarks: order.remarks || '',
  }];
};

const summarizeOrder = (order) => {
  const items = getOrderItems(order);
  return {
    items,
    itemCount: items.length,
    quantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    total: items.reduce((sum, item) => sum + (Number(item.sellingPrice || 0) * Number(item.quantity || 0)), 0),
    expectedDate: items.find((item) => item.expectedArrivalDate)?.expectedArrivalDate || order?.expectedArrivalDate,
    itemNames: items.map((item) => item.itemName).filter(Boolean),
  };
};

const ItemEditor = ({ item, index, itemCount, disabled, errors = {}, fieldRefs, onChange, onRemove }) => {
  const fieldId = (field) => `special-order-item-${index}-${field}-error`;
  const inputProps = (field) => ({
    ref: (element) => {
      if (element) fieldRefs.current[`items.${index}.${field}`] = element;
      else delete fieldRefs.current[`items.${index}.${field}`];
    },
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? fieldId(field) : undefined,
  });

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500">Item {index + 1}</span>
        {itemCount > 1 && (
          <button type="button" onClick={() => onRemove(index)} disabled={disabled} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50">
            Remove
          </button>
        )}
      </div>
      <div className="grid gap-2.5 md:grid-cols-6">
        <label className="md:col-span-3">
          <span className={LABEL_CLASS}>Item name <span className="text-red-600">*</span></span>
          <input {...inputProps('itemName')} value={item.itemName} onChange={(event) => onChange(index, 'itemName', event.target.value)} className={getInputClass(errors.itemName)} placeholder="Item name" required />
          <FieldError id={fieldId('itemName')} message={errors.itemName} />
        </label>
        <label className="md:col-span-3">
          <span className={LABEL_CLASS}>Supplier</span>
          <input value={item.supplierName} onChange={(event) => onChange(index, 'supplierName', event.target.value)} className={INPUT_CLASS} placeholder="Supplier" />
        </label>
        <label className="md:col-span-2">
          <span className={LABEL_CLASS}>Quantity <span className="text-red-600">*</span></span>
          <input {...inputProps('quantity')} type="text" inputMode="numeric" pattern="[0-9]*" min="1" value={item.quantity} onKeyDown={preventInvalidWholeNumberKeyDown} onPaste={preventInvalidWholeNumberPaste} onChange={(event) => onChange(index, 'quantity', sanitizeWholeNumberInput(event.target.value))} className={getInputClass(errors.quantity)} required />
          <FieldError id={fieldId('quantity')} message={errors.quantity} />
        </label>
        <label className="md:col-span-2">
          <span className={LABEL_CLASS}>Purchase Cost <span className="text-red-600">*</span></span>
          <input {...inputProps('purchaseCost')} type="text" inputMode="decimal" value={item.purchaseCost} onKeyDown={preventInvalidMoneyKeyDown} onPaste={preventInvalidMoneyPaste} onChange={(event) => onChange(index, 'purchaseCost', sanitizeMoneyInput(event.target.value))} onBlur={(event) => onChange(index, 'purchaseCost', formatMoneyInput(event.target.value))} className={getInputClass(errors.purchaseCost)} placeholder="0.00" required />
          <FieldError id={fieldId('purchaseCost')} message={errors.purchaseCost} />
        </label>
        <label className="md:col-span-2">
          <span className={LABEL_CLASS}>Selling Price <span className="text-red-600">*</span></span>
          <input {...inputProps('sellingPrice')} type="text" inputMode="decimal" value={item.sellingPrice} onKeyDown={preventInvalidMoneyKeyDown} onPaste={preventInvalidMoneyPaste} onChange={(event) => onChange(index, 'sellingPrice', sanitizeMoneyInput(event.target.value))} onBlur={(event) => onChange(index, 'sellingPrice', formatMoneyInput(event.target.value))} className={getInputClass(errors.sellingPrice)} placeholder="0.00" required />
          <FieldError id={fieldId('sellingPrice')} message={errors.sellingPrice} />
        </label>
        <label className="md:col-span-6">
          <span className={LABEL_CLASS}>Expected Date <span className="text-red-600">*</span></span>
          <input {...inputProps('expectedArrivalDate')} type="date" min={getTodayInputDate()} value={item.expectedArrivalDate} onChange={(event) => onChange(index, 'expectedArrivalDate', event.target.value)} className={getInputClass(errors.expectedArrivalDate)} required />
          <FieldError id={fieldId('expectedArrivalDate')} message={errors.expectedArrivalDate} />
        </label>
        <label className="md:col-span-6">
          <span className={LABEL_CLASS}>Description</span>
          <input value={item.description} onChange={(event) => onChange(index, 'description', event.target.value)} className={INPUT_CLASS} placeholder="Item description" />
        </label>
        <label className="md:col-span-6">
          <span className={LABEL_CLASS}>Item Notes (Optional)</span>
          <input value={item.remarks} onChange={(event) => onChange(index, 'remarks', event.target.value)} className={INPUT_CLASS} placeholder="Optional item notes" />
        </label>
      </div>
    </div>
  );
};

const SpecialOrders = () => {
  const { logActivity } = useInventory();
  const { currentUserName } = useAuth();
  const [orders, setOrders] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderToComplete, setOrderToComplete] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [form, setForm] = useState(createEmptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderAction, setOrderAction] = useState('');
  const loadRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const hasLoadedOnceRef = useRef(false);
  const inFlightLoadRef = useRef(null);
  const submitInFlightRef = useRef(false);
  const orderActionInFlightRef = useRef(false);
  const formFieldRefs = useRef({});

  const loadOrders = useCallback(async () => {
    const requestKey = `${statusFilter}\u0000${searchTerm}`;
    if (inFlightLoadRef.current?.key === requestKey) return inFlightLoadRef.current.promise;

    const requestId = ++loadRequestIdRef.current;
    if (!hasLoadedOnceRef.current) setInitialLoading(true);
    else setRefreshing(true);

    const requestPromise = listSpecialOrdersApi({ status: statusFilter, search: searchTerm });
    inFlightLoadRef.current = { key: requestKey, promise: requestPromise };

    try {
      const rows = await requestPromise;
      if (isMountedRef.current && requestId === loadRequestIdRef.current) {
        setOrders(Array.isArray(rows) ? rows : []);
      }
    } catch (error) {
      if (isMountedRef.current && requestId === loadRequestIdRef.current) {
        showToast('Load Failed', error.message || 'Unable to load special orders.', 'error', 'special-orders-load');
      }
    } finally {
      if (inFlightLoadRef.current?.promise === requestPromise) inFlightLoadRef.current = null;
      if (isMountedRef.current && requestId === loadRequestIdRef.current) {
        hasLoadedOnceRef.current = true;
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [searchTerm, statusFilter]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    const unsubscribe = subscribeRealtimeEvent('special-order.updated', () => {
      void loadOrders();
    });
    return () => unsubscribe();
  }, [loadOrders]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter]);

  const formSummary = useMemo(() => {
    return (form.items || []).reduce((summary, item) => ({
      itemCount: summary.itemCount + 1,
      quantity: summary.quantity + Number(item.quantity || 0),
      total: summary.total + (Number(item.sellingPrice || 0) * Number(item.quantity || 0)),
    }), { itemCount: 0, quantity: 0, total: 0 });
  }, [form.items]);

  const selectedSummary = useMemo(() => selectedOrder ? summarizeOrder(selectedOrder) : null, [selectedOrder]);
  const totalPages = Math.ceil(orders.length / SPECIAL_ORDERS_PER_PAGE);
  const activePage = Math.min(currentPage, Math.max(totalPages, 1));
  const indexOfFirstOrder = (activePage - 1) * SPECIAL_ORDERS_PER_PAGE;
  const paginatedOrders = orders.slice(indexOfFirstOrder, indexOfFirstOrder + SPECIAL_ORDERS_PER_PAGE);
  const displayStart = orders.length === 0 ? 0 : indexOfFirstOrder + 1;
  const displayEnd = Math.min(indexOfFirstOrder + SPECIAL_ORDERS_PER_PAGE, orders.length);

  useEffect(() => {
    setCurrentPage((previous) => Math.min(previous, Math.max(totalPages, 1)));
  }, [totalPages]);

  const openCreateForm = () => {
    setEditingOrder(null);
    setForm(createEmptyForm());
    setFormErrors({});
    setShowForm(true);
  };

  const closeForm = ({ force = false } = {}) => {
    if (isSubmitting && !force) return;
    setShowForm(false);
    setEditingOrder(null);
    setForm(createEmptyForm());
    setFormErrors({});
  };

  const openEditForm = (order) => {
    if (!canEditSpecialOrder(order)) return;
    setSelectedOrder(null);
    setEditingOrder(order);
    setForm({
      customerName: order.customerName || '',
      remarks: order.remarks || '',
      items: getOrderItems(order).map((item) => createFormItem({
        itemName: item.itemName || '',
        description: item.description || '',
        quantity: item.quantity ?? '',
        supplierName: item.supplierName || '',
        purchaseCost: formatMoneyInput(item.purchaseCost),
        sellingPrice: formatMoneyInput(item.sellingPrice),
        expectedArrivalDate: item.expectedArrivalDate ? String(item.expectedArrivalDate).slice(0, 10) : '',
        remarks: item.remarks || '',
      })),
    });
    setFormErrors({});
    setShowForm(true);
  };

  const addItemRow = () => {
    setForm((previous) => ({ ...previous, items: [...(previous.items || []), createFormItem()] }));
  };

  const removeItemRow = (index) => {
    setForm((previous) => {
      const items = (previous.items || []).filter((_, currentIndex) => currentIndex !== index);
      return { ...previous, items: items.length > 0 ? items : [createFormItem()] };
    });
    setFormErrors((previous) => ({ ...previous, items: {} }));
  };

  const updateItemRow = (index, field, value) => {
    setForm((previous) => ({
      ...previous,
      items: (previous.items || []).map((item, currentIndex) => currentIndex === index ? { ...item, [field]: value } : item),
    }));
    setFormErrors((previous) => {
      if (!previous.items?.[index]?.[field]) return previous;
      const items = { ...previous.items, [index]: { ...previous.items[index] } };
      delete items[index][field];
      return { ...previous, items };
    });
  };

  const focusFirstInvalidField = (field) => {
    window.requestAnimationFrame(() => {
      const input = formFieldRefs.current[field];
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input?.focus();
    });
  };

  const validateForm = (items) => {
    const errors = { items: {} };
    let firstInvalidField = '';
    const addError = (field, message) => {
      if (!firstInvalidField) firstInvalidField = field;
      if (field === 'customerName') {
        errors.customerName = message;
        return;
      }
      const [, index, itemField] = field.split('.');
      errors.items[index] = { ...(errors.items[index] || {}), [itemField]: message };
    };

    if (!String(form.customerName || '').trim()) addError('customerName', 'Customer is required.');

    items.forEach((item, index) => {
      const prefix = `items.${index}`;
      if (!String(item.itemName || '').trim()) addError(`${prefix}.itemName`, 'Item name is required.');
      if (!isWholeNumberInput(item.quantity, { min: 1 })) addError(`${prefix}.quantity`, 'Quantity must be a whole number of at least 1.');

      const hasValidPurchaseCost = isMoneyInput(item.purchaseCost) && Number(item.purchaseCost) > 0;
      if (!hasValidPurchaseCost) addError(`${prefix}.purchaseCost`, isMoneyInputTooLarge(item.purchaseCost) ? 'Amount is too large. Please enter a smaller value.' : 'Purchase cost is required and must be greater than 0.');

      const hasValidSellingPrice = isMoneyInput(item.sellingPrice) && Number(item.sellingPrice) > 0;
      if (!hasValidSellingPrice) addError(`${prefix}.sellingPrice`, isMoneyInputTooLarge(item.sellingPrice) ? 'Amount is too large. Please enter a smaller value.' : 'Selling price is required and must be greater than 0.');

      if (!String(item.expectedArrivalDate || '').trim()) addError(`${prefix}.expectedArrivalDate`, 'Expected date is required.');
      else if (!isTodayOrLater(item.expectedArrivalDate)) addError(`${prefix}.expectedArrivalDate`, 'Expected date cannot be earlier than today.');
    });

    return { errors, firstInvalidField };
  };

  const saveForm = async (event) => {
    event.preventDefault();
    if (submitInFlightRef.current) return;
    const normalizedItems = (form.items || []).map((item) => ({
      ...item,
      purchaseCost: item.purchaseCost === '' ? '' : formatMoneyInput(item.purchaseCost),
      sellingPrice: item.sellingPrice === '' ? '' : formatMoneyInput(item.sellingPrice),
    }));
    const { errors, firstInvalidField } = validateForm(normalizedItems);
    if (firstInvalidField) {
      setFormErrors(errors);
      focusFirstInvalidField(firstInvalidField);
      return;
    }

    setFormErrors({});

    submitInFlightRef.current = true;
    const payload = {
      customerName: form.customerName,
      remarks: form.remarks,
      items: normalizedItems.map((item) => ({
        itemName: item.itemName,
        description: item.description,
        quantity: Number(item.quantity),
        supplierName: item.supplierName,
        purchaseCost: Number(item.purchaseCost),
        sellingPrice: Number(item.sellingPrice),
        expectedArrivalDate: item.expectedArrivalDate,
        remarks: item.remarks,
      })),
    };

    setIsSubmitting(true);
    try {
      const saved = editingOrder
        ? await updateSpecialOrderApi(editingOrder._id, payload)
        : await createSpecialOrderApi(payload);
      setOrders((previous) => [saved, ...previous.filter((row) => row._id !== saved._id)]);
      closeForm({ force: true });
      showToast('Saved', 'Special order saved successfully.', 'success', 'special-order-save');
      logActivity(currentUserName, editingOrder ? 'Updated Special Order' : 'Created Special Order', `${saved.orderNumber} - ${saved.itemName}`);
      void loadOrders();
    } catch (error) {
      showToast('Save Failed', error.message || 'Unable to save special order.', 'error', 'special-order-save-error');
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const completeOrder = async (order) => {
    if (orderActionInFlightRef.current) return;
    orderActionInFlightRef.current = true;
    setOrderAction('complete');
    try {
      const result = await completeSpecialOrderApi(order._id);
      if (result?.order) {
        setOrders((previous) => previous.map((row) => row._id === result.order._id ? result.order : row));
      }
      setSelectedOrder(null);
      setOrderToComplete(null);
      showToast('Completed', 'Special order was converted to a sale.', 'success', 'special-order-complete');
      void loadOrders();
    } catch (error) {
      showToast('Completion Failed', error.message || 'Unable to complete special order.', 'error', 'special-order-complete-error');
    } finally {
      orderActionInFlightRef.current = false;
      setOrderAction('');
    }
  };

  const closeDetails = () => {
    if (!orderAction) setSelectedOrder(null);
  };

  const openCompleteConfirmation = (order) => {
    if (orderAction || order?.status !== 'In Progress') return;
    setSelectedOrder(null);
    setOrderToComplete(order);
  };

  const closeCompleteConfirmation = () => {
    if (!orderAction) setOrderToComplete(null);
  };

  return (
    <div className="flex h-auto flex-col gap-2 md:h-[calc(100vh-80px)] md:overflow-hidden">
      <section className="flex min-h-full flex-col overflow-hidden rounded-2xl border border-slate-300 bg-slate-200/50 p-4 shadow-inner md:h-full">
        <header className="flex flex-col items-start gap-1 border-b border-gray-200 pb-3">
          <div>
            <p className="text-3xl font-bold leading-tight text-gray-900 md:text-4xl">Special Orders</p>
            <p className="text-[11px] font-medium text-gray-500 md:text-xs">Create, track, and complete customer-requested items.</p>
          </div>
        </header>

        <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
          <div className="main-toolbar-search group">
            <input type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search Special Orders..." className="main-toolbar-search-input" />
            <div className="main-toolbar-search-icon" aria-hidden="true"><svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
          </div>
          <ToolbarDropdown value={statusFilter} options={statusOptions.map((status) => ({ value: status, label: status }))} onChange={setStatusFilter} ariaLabel="Filter special orders by status" className="w-full sm:w-40" />
          <button type="button" onClick={openCreateForm} className={`${PRIMARY_BUTTON_CLASS} sm:ml-auto`}>
            New Special Order
          </button>
          {refreshing && !initialLoading && <span className="text-[11px] font-semibold text-gray-500">Refreshing...</span>}
        </div>

        <div className="main-data-table-shell mt-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-100 shadow-sm">
          <div className="flex-1 overflow-auto" aria-busy={initialLoading || refreshing}>
            {initialLoading ? (
            <div className="flex min-h-64 items-center justify-center px-4 py-12 text-sm font-medium text-gray-500">Loading special orders...</div>
          ) : orders.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-4 py-12 text-center">
              <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 px-8 py-7">
              <p className="font-semibold text-gray-800">{searchTerm ? 'No matching special orders' : 'No special orders yet'}</p>
              <p className="mt-1 text-sm text-gray-500">{searchTerm ? 'Try a different search or status filter.' : 'Create a special order to get started.'}</p>
              </div>
            </div>
          ) : (
            <table className="main-data-table w-full min-w-0 table-fixed border-separate border-spacing-0 text-left max-lg:min-w-[760px]">
              <thead className="sticky top-0 z-10 shadow-sm">
                <tr className="bg-gray-900 text-white uppercase tracking-wider">
                  <th className="w-[15%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Reference</th>
                  <th className="w-[14%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Customer</th>
                  <th className="w-[19%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Items</th>
                  <th className="w-[11%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Order Date</th>
                  <th className="w-[12%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Expected Date</th>
                  <th className="w-[10%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Total</th>
                  <th className="w-[10%] border border-gray-700 px-1.5 py-2 text-center text-[11px] font-semibold">Status</th>
                  <th className="w-[8%] border border-gray-700 px-1 py-2 text-center text-[11px] font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {paginatedOrders.map((order) => {
                  const summary = summarizeOrder(order);
                  const canEdit = canEditSpecialOrder(order);
                  const isInProgress = order.status === 'In Progress';
                  const viewTooltipId = `special-order-${order._id}-view-tooltip`;
                  const editTooltipId = `special-order-${order._id}-edit-tooltip`;
                  return (
                    <tr
                      key={order._id}
                      role="button"
                      tabIndex={0}
                      aria-label={`View details for special order ${order.orderNumber}`}
                      onClick={() => setSelectedOrder(order)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedOrder(order);
                        }
                      }}
                      className={`cursor-pointer border-b border-gray-200 transition-colors duration-200 focus:outline-none ${
                        isInProgress
                          ? 'special-order-in-progress-row bg-gray-100 hover:bg-gray-100 focus:bg-gray-100'
                          : 'hover:bg-gray-50 focus:bg-gray-50'
                      }`}
                    >
                      <td className="whitespace-nowrap border border-gray-200 px-1.5 py-1.5 text-center"><IdentifierChip className="break-normal whitespace-nowrap px-1.5">{order.orderNumber}</IdentifierChip></td>
                      <td className="truncate border border-gray-200 px-1.5 py-1.5 text-center text-xs font-medium text-gray-800">{order.customerName}</td>
                      <td className="border border-gray-200 px-1.5 py-1.5 text-center">
                        <div className="flex flex-col items-center leading-tight">
                          <span className="max-w-full truncate font-medium text-gray-800">{summary.itemNames.slice(0, 2).join(', ') || order.itemName}</span>
                          <span className="text-xs text-gray-500">{summary.itemCount} item{summary.itemCount === 1 ? '' : 's'}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap border border-gray-200 px-1.5 py-1.5 text-center text-xs font-medium text-gray-700">{formatDate(order.createdAt)}</td>
                      <td className="whitespace-nowrap border border-gray-200 px-1.5 py-1.5 text-center text-xs font-medium text-gray-700">{formatDate(summary.expectedDate)}</td>
                      <td className="whitespace-nowrap border border-gray-200 px-1.5 py-1.5 text-center text-sm font-semibold tabular-nums text-gray-900">{formatMoney(summary.total || order.sellingPrice)}</td>
                      <td className="whitespace-nowrap border border-gray-200 px-1.5 py-1.5 text-center">
                        <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(order.status)}`}>{order.status}</span>
                      </td>
                      <td className="border border-gray-200 px-1 py-1.5 text-center">
                        <div className="inline-flex items-center gap-1 whitespace-nowrap">
                          <span className="group/tooltip relative inline-flex">
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); setSelectedOrder(order); }}
                              className="inline-flex items-center rounded-lg border border-black bg-white px-2 py-1.5 text-black transition-all hover:bg-gray-100 dark:border-gray-500 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
                              aria-label="View Details"
                              aria-describedby={viewTooltipId}
                            >
                              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M1.5 12s3.6-7 10.5-7 10.5 7 10.5 7-3.6 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></svg>
                            </button>
                            <span id={viewTooltipId} role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100">View Details</span>
                          </span>
                          <span className="group/tooltip relative inline-flex">
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={(event) => { event.stopPropagation(); if (canEdit) openEditForm(order); }}
                              className={`inline-flex shrink-0 items-center rounded-lg border border-gray-200 bg-white px-2 py-1.5 transition-all ${canEdit ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-800' : 'cursor-not-allowed text-gray-400 opacity-60'}`}
                              aria-label="Edit"
                              aria-describedby={editTooltipId}
                            >
                              <EditIcon aria-hidden="true" />
                            </button>
                            <span id={editTooltipId} role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100">Edit</span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>

          <div className="shrink-0 border-t border-gray-200 bg-slate-200/95 px-4 py-2 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur-sm md:px-6 md:py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium text-gray-500">
                Showing <span className="font-semibold text-gray-900">{displayStart}</span> to <span className="font-semibold text-gray-900">{displayEnd}</span> of <span className="font-semibold text-gray-900">{orders.length}</span> results
              </div>
              <Pagination currentPage={activePage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </div>
          </div>
        </div>
      </section>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => closeForm()}>
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-2xl ring-1 ring-black/5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{editingOrder ? 'Edit Special Order' : 'New Special Order'}</h2>
                <p className="mt-0.5 text-xs font-medium text-gray-500">{editingOrder ? editingOrder.orderNumber : 'Create a customer-requested special order.'}</p>
              </div>
              <button type="button" onClick={() => closeForm()} disabled={isSubmitting} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50" aria-label="Close special order form"><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>

            <form noValidate onSubmit={saveForm} className="flex min-h-0 flex-1 flex-col">
              <div className="space-y-3 overflow-y-auto px-4 py-3">
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Order Information</h3>
                  <label className="block">
                    <span className={LABEL_CLASS}>Customer <span className="text-red-600">*</span></span>
                    <input ref={(element) => { if (element) formFieldRefs.current.customerName = element; else delete formFieldRefs.current.customerName; }} aria-invalid={Boolean(formErrors.customerName)} aria-describedby={formErrors.customerName ? 'special-order-customer-error' : undefined} value={form.customerName} onChange={(event) => { setForm((previous) => ({ ...previous, customerName: event.target.value })); setFormErrors((previous) => ({ ...previous, customerName: '' })); }} className={getInputClass(formErrors.customerName)} placeholder="Customer name" required />
                    <FieldError id="special-order-customer-error" message={formErrors.customerName} />
                  </label>
                </section>

                <section className="border-t border-gray-200 pt-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Items</h3>
                    <button type="button" onClick={addItemRow} disabled={isSubmitting} className={SECONDARY_BUTTON_CLASS}>Add Another Item</button>
                  </div>
                  <div className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
                    {(form.items || []).map((item, index) => (
                      <ItemEditor key={item.__rowId || index} item={item} index={index} itemCount={(form.items || []).length} disabled={isSubmitting} errors={formErrors.items?.[index]} fieldRefs={formFieldRefs} onChange={updateItemRow} onRemove={removeItemRow} />
                    ))}
                  </div>
                </section>

                <section className="border-t border-gray-200 pt-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Notes and Summary</h3>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <label><span className={LABEL_CLASS}>Order notes</span><textarea value={form.remarks} onChange={(event) => setForm((previous) => ({ ...previous, remarks: event.target.value }))} rows={2} className={INPUT_CLASS} placeholder="Optional notes" /></label>
                    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 md:justify-end md:pb-1">
                      <div className="flex gap-1"><dt>Items:</dt><dd className="font-semibold text-gray-900">{formSummary.itemCount}</dd></div>
                      <div className="flex gap-1"><dt>Total Qty:</dt><dd className="font-semibold text-gray-900">{formSummary.quantity}</dd></div>
                      <div className="flex gap-1"><dt>Total:</dt><dd className="font-semibold text-gray-900">{formatMoney(formSummary.total)}</dd></div>
                    </dl>
                  </div>
                </section>
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-2.5">
                <button type="button" onClick={() => closeForm()} disabled={isSubmitting} className={SECONDARY_BUTTON_CLASS}>Cancel</button>
                <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>{isSubmitting ? 'Saving...' : editingOrder ? 'Save Changes' : 'Create Special Order'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedOrder && selectedSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={closeDetails}>
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-2xl ring-1 ring-black/5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-gray-900">{selectedOrder.orderNumber}</h2>
                  <span className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(selectedOrder.status)}`}>{selectedOrder.status}</span>
                </div>
                <p className="mt-1 text-xs font-medium text-gray-500">Special order details</p>
              </div>
              <button type="button" onClick={closeDetails} disabled={Boolean(orderAction)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50" aria-label="Close special order details"><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>

            <div className="overflow-y-auto px-4 py-3">
              <dl className="grid gap-2 border-b border-gray-200 pb-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-xs text-gray-500">Customer</dt><dd className="mt-1 font-medium text-gray-900">{selectedOrder.customerName}</dd></div>
                <div><dt className="text-xs text-gray-500">Order date</dt><dd className="mt-1 font-medium text-gray-900">{formatDate(selectedOrder.createdAt)}</dd></div>
                <div><dt className="text-xs text-gray-500">Expected date</dt><dd className="mt-1 font-medium text-gray-900">{formatDate(selectedSummary.expectedDate)}</dd></div>
                <div><dt className="text-xs text-gray-500">Total</dt><dd className="mt-1 font-medium text-gray-900">{formatMoney(selectedSummary.total || selectedOrder.sellingPrice)}</dd></div>
              </dl>

              <section className="py-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Items</h3>
                <div className="overflow-hidden rounded-xl border border-gray-100 shadow-sm">
                  <div className="hidden grid-cols-[1.5fr_1fr_.5fr_.8fr_.8fr] gap-3 border-b border-gray-700 bg-gray-900 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-white sm:grid">
                    <span>Item</span><span>Supplier</span><span>Qty</span><span>Cost</span><span>Price</span>
                  </div>
                  <div className="divide-y divide-gray-200">
                    {selectedSummary.items.map((item, index) => (
                      <div key={`${selectedOrder._id}-item-${index}`} className="grid gap-2 px-3 py-3 text-sm sm:grid-cols-[1.5fr_1fr_.5fr_.8fr_.8fr] sm:gap-3">
                        <span><span className="block font-medium text-gray-900">{item.itemName}</span>{item.description && <span className="block text-xs text-gray-500">{item.description}</span>}</span>
                        <span className="text-gray-600">{item.supplierName || '-'}</span><span>{Number(item.quantity || 0)}</span><span>{formatMoney(item.purchaseCost)}</span><span>{formatMoney(item.sellingPrice)}</span>
                        {(item.remarks || item.expectedArrivalDate) && <span className="text-xs text-gray-500 sm:col-span-5">{item.expectedArrivalDate ? `Expected ${formatDate(item.expectedArrivalDate)}` : ''}{item.expectedArrivalDate && item.remarks ? ' / ' : ''}{item.remarks || ''}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <div className="grid gap-3 border-t border-gray-200 pt-3 text-sm sm:grid-cols-2">
                <div><p className="text-xs text-gray-500">Order notes</p><p className="mt-1 text-gray-700">{selectedOrder.remarks || '-'}</p></div>
                <div className="sm:text-right"><p className="text-xs text-gray-500">Summary</p><p className="mt-1 font-medium text-gray-900">{selectedSummary.itemCount} item{selectedSummary.itemCount === 1 ? '' : 's'} / {selectedSummary.quantity} total quantity</p></div>
              </div>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-2.5">
              <button type="button" onClick={closeDetails} disabled={Boolean(orderAction)} className={SECONDARY_BUTTON_CLASS}>Close</button>
              {canEditSpecialOrder(selectedOrder) && (
                <button type="button" onClick={() => openCompleteConfirmation(selectedOrder)} disabled={Boolean(orderAction)} className={PRIMARY_BUTTON_CLASS}>Complete</button>
              )}
            </div>
          </div>
        </div>
      )}

      {orderToComplete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={closeCompleteConfirmation}>
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-gray-100 bg-white shadow-2xl ring-1 ring-black/5" onClick={(event) => event.stopPropagation()}>
            <div className="border-b-2 border-gray-200 px-5 py-4">
              <h2 className="text-xl font-semibold text-gray-900">Complete Special Order?</h2>
              <p className="mt-1 text-xs font-medium text-gray-500">{orderToComplete.orderNumber}</p>
            </div>
            <p className="px-5 py-4 text-sm leading-6 text-gray-700">This will mark the order as completed and create its existing sales record. It will not add the items to normal inventory.</p>
            <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
              <button type="button" onClick={closeCompleteConfirmation} disabled={Boolean(orderAction)} className={SECONDARY_BUTTON_CLASS}>Cancel</button>
              <button type="button" onClick={() => completeOrder(orderToComplete)} disabled={Boolean(orderAction)} className={PRIMARY_BUTTON_CLASS}>{orderAction === 'complete' ? 'Completing...' : 'Complete Order'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpecialOrders;
