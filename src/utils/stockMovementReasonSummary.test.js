import assert from 'node:assert/strict';
import test from 'node:test';
import { getStockMovementReasonSummary } from './stockMovementReasonSummary.js';

test('summarizes insufficient observation, stock and data quality reasons with accurate counts', () => {
    const summary = getStockMovementReasonSummary([
        { reason: 'Insufficient observation history (8 of 14 required days).' },
        { reason: 'Insufficient observation history for non-moving status (14 of 30 required days).' },
        { reason: 'Insufficient stock availability history to confirm non-moving status.' },
        { reason: 'Missing or inconsistent selling unit / sales quantity data.' },
        { reason: 'Selling unit is not configured for this category.' },
        { reason: 'Missing, inactive or ambiguous category identity.' },
        { reason: 'Historical sales identity cannot be resolved safely.' },
        { reason: 'No current stock available to confirm non-moving status.' },
    ]);

    assert.deepEqual(summary, [
        { label: 'Insufficient observation history', count: 2 },
        { label: 'Insufficient stock history', count: 1 },
        { label: 'Missing or invalid selling unit / quantity data', count: 2 },
        { label: 'Category assignment needs review', count: 1 },
        { label: 'Sales identity needs review', count: 1 },
        { label: 'No current stock available', count: 1 },
    ]);
});

test('keeps unknown backend explanations visible instead of inventing a category', () => {
    const reason = 'A future backend reason.';
    assert.deepEqual(getStockMovementReasonSummary([{ reason }]), [{ label: reason, count: 1 }]);
});
