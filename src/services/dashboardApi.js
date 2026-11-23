import { apiRequest } from './apiClient';

export const getStockMovementApi = async (query, signal) => {
    const data = await apiRequest(`/api/dashboard/stock-movement?${query}`, { signal });
    if (!data?.period || !data?.policy || !Array.isArray(data.limitations)
        || !Array.isArray(data.categories) || data.categories.some((category) => typeof category.id !== 'string' || typeof category.name !== 'string')
        || typeof data.selection?.categoryId !== 'string' || data.metric?.key !== 'unitsPerDay'
        || data.period.timeZone !== 'Asia/Manila' || data.period.days !== 30 || data.period.endExclusive !== true
        || data.policy.windowDays !== 30 || !Number.isFinite(data.policy.minimumObservationDays)
        || !Number.isFinite(data.policy.minimumNonMovingObservationDays) || !Number.isFinite(data.policy.fastVelocityUnitsPerDay)
        || ['fast', 'slow', 'nonMoving', 'insufficientHistory'].some((key) => !Array.isArray(data[key]?.entries) || data[key].count !== data[key].entries.length
            || data[key].entries.some((entry) => !Number.isFinite(entry.unitsSold) || !Number.isFinite(entry.regularUnitsSold)
                || !Number.isFinite(entry.specialOrderUnitsSold) || (entry.currentStock !== null && !Number.isFinite(entry.currentStock))
                || (entry.salesVelocity !== null && !Number.isFinite(entry.salesVelocity))))) {
        throw new Error('Stock movement data could not be verified. Please retry.');
    }
    return data;
};
