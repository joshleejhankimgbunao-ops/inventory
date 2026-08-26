const asFiniteNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

export const formatNumber = (value, options = {}) => new Intl.NumberFormat('en-PH', {
    maximumFractionDigits: 0,
    ...options,
}).format(asFiniteNumber(value));

export const formatCurrency = (value) => `₱${formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})}`;

export const formatMoney = (value) => formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
