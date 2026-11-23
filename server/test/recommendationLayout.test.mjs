import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getInitialAlternativePreview, hasAdditionalAlternatives, MOBILE_ALTERNATIVE_LIMIT } from '../../src/utils/recommendationLayout.js';

const alternatives = (count) => Array.from({ length: count }, (_, index) => ({ code: `SKU-${index + 1}` }));

for (const count of [0, 1, 2, 3, 4, 8]) {
    test(`alternative preview handles ${count} alternatives without changing order or count`, () => {
        const entries = alternatives(count);
        const preview = getInitialAlternativePreview(entries);
        assert.deepEqual(preview, entries.slice(0, 2));
        assert.equal(hasAdditionalAlternatives(entries), count > 2);
        assert.equal(hasAdditionalAlternatives(entries, MOBILE_ALTERNATIVE_LIMIT), count > 1);
        assert.equal(entries.length, count);
    });
}

test('main preview and View All drawer use the same card renderer and preserve card actions', async () => {
    const source = await readFile(new URL('../../src/pages/Recommendation.jsx', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
    assert.match(source, /visibleAlternatives\.map\(\(alternative\) => renderAlternativeCard\(item, alternative, systemCodes\)\)/);
    assert.match(source, /drawerRecommendations\.map\(\(alternative\) => renderAlternativeCard\(recommendationDrawerTarget, alternative, drawerSystemCodes, true\)\)/);
    assert.match(source, /View All \(\{alternativeCount\}\)/);
    assert.match(source, /recommendation-view-all-mobile/);
    assert.match(source, /recommendation-view-all-desktop/);
    assert.match(source, /renderEditBasis\(target, alternative, sources\)/);
    assert.match(source, /renderReviewActions\(target, alternative, sources, inDrawer\)/);
    assert.match(source, /handleRemoveAlternative\(target, alternative\.recommendation/);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /if \(event\.key === 'Escape'\)[\s\S]*setRecommendationDrawerTarget\(null\)/);
    assert.match(source, /aria-label="Close recommendations"/);
    assert.match(source, /className="fixed inset-0 z-\[65\] flex justify-end bg-black\/25 backdrop-blur-\[3px\] animate-in fade-in duration-200"/);
    assert.match(source, /className="recommendation-modal flex h-full min-h-0 w-full max-w-\[26rem\][\s\S]*animate-in slide-in-from-right duration-200"/);
    assert.match(source, /<h3 id="all-recommendations-title"[^>]*>All Alternative Products<\/h3>/);
    assert.match(source, /<p className="mt-1 break-words text-xs leading-snug text-slate-600">\{recommendationDrawerTarget\.name\}<\/p>/);
    assert.match(source, /const drawerRecommendations = reviewBlockedOnly \? getBlockedRecommendationEntries\(allDrawerRecommendations\) : allDrawerRecommendations;/);
    assert.match(source, /reviewBlockedOnly \? <div className="space-y-2\.5">[\s\S]*drawerRecommendations\.map/);
    assert.match(source, /<p className="text-\[10px\] font-semibold uppercase tracking-wider text-slate-400">Excluded \/ Rejected<\/p>[\s\S]*Active exclusions and rejected automatic suggestions\./);
    assert.match(styles, /recommendation-alternative-section \.recommendation-alternative-grid > :nth-child\(n \+ 2\) \{\s+display: none;/);
    assert.match(styles, /@container recommendation-alternatives \(min-width: 42rem\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(styles, /@container recommendation-all-alternatives \(min-width: 56rem\)[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});

test('review blocked and View All controls use their intended neutral and primary treatments', async () => {
    const source = await readFile(new URL('../../src/pages/Recommendation.jsx', import.meta.url), 'utf8');
    assert.match(source, /className="inline-flex min-h-7 w-fit items-center justify-center rounded-md border border-slate-300 bg-slate-100 px-2\.5 py-1 text-\[11px\] font-medium text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-200 active:bg-slate-200 focus-visible:outline-none focus-visible:ring-2/);
    assert.match(source, /Review excluded \/ rejected/);
    assert.equal((source.match(/recommendation-view-all-(?:mobile|desktop) \$\{primaryActionClass\}/g) || []).length, 2);
    assert.equal((source.match(/recommendation-view-all-(?:mobile|desktop) \$\{secondaryActionClass\}/g) || []).length, 0);
});
