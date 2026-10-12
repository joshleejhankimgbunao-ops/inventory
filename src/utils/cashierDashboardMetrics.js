import { getValidSales } from '../../shared/saleLifecycle.mjs';

const normalizeId = (value) => String(value || '').trim();
const normalizeName = (value) => String(value || '').trim().toLocaleLowerCase();

const getCashierReferenceId = (sale) => {
    const cashierUser = sale?.cashierUser;
    if (cashierUser && typeof cashierUser === 'object') {
        const referenceId = normalizeId(cashierUser.id || cashierUser._id);
        if (referenceId) return referenceId;
    }

    return normalizeId(sale?.cashierId);
};

export const isSaleHandledByCashier = (sale, { cashierId = '', cashierName = '' } = {}) => {
    const currentCashierId = normalizeId(cashierId);
    const saleCashierId = getCashierReferenceId(sale);

    // Persisted user references are authoritative. A name fallback is only for
    // historical records that genuinely predate the cashier relationship.
    if (saleCashierId) {
        return Boolean(currentCashierId && saleCashierId === currentCashierId);
    }

    const currentCashierName = normalizeName(cashierName);
    return Boolean(currentCashierName && normalizeName(sale?.cashier) === currentCashierName);
};

export const getCashierDashboardSales = (sales, cashierIdentity) => (
    getValidSales(sales).filter((sale) => isSaleHandledByCashier(sale, cashierIdentity))
);

export const getCashierSalesTotal = (sales) => (
    sales.reduce((total, sale) => total + (Number(sale?.total) || 0), 0)
);
