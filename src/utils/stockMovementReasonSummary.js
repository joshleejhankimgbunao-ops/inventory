const REASON_GROUPS = [
    { label: 'Insufficient observation history', matches: /observation history/i },
    { label: 'Insufficient stock history', matches: /stock .*history/i },
    { label: 'Missing or invalid selling unit / quantity data', matches: /selling[\s-]?unit|quantity/i },
    { label: 'Category assignment needs review', matches: /category identity/i },
    { label: 'Sales identity needs review', matches: /sales identity/i },
    { label: 'No current stock available', matches: /current stock/i },
];

export const getStockMovementReasonSummary = (entries = []) => {
    const counts = new Map();

    for (const entry of entries) {
        const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : '';
        if (!reason) continue;

        const group = REASON_GROUPS.find(({ matches }) => matches.test(reason));
        const label = group?.label || reason;
        counts.set(label, (counts.get(label) || 0) + 1);
    }

    return [...counts].map(([label, count]) => ({ label, count }));
};
