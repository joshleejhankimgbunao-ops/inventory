export const INITIAL_ALTERNATIVE_LIMIT = 2;
export const MOBILE_ALTERNATIVE_LIMIT = 1;

export const getInitialAlternativePreview = (alternatives) => (
    Array.isArray(alternatives) ? alternatives.slice(0, INITIAL_ALTERNATIVE_LIMIT) : []
);

export const hasAdditionalAlternatives = (alternatives, visibleLimit = INITIAL_ALTERNATIVE_LIMIT) => (
    Array.isArray(alternatives) && alternatives.length > visibleLimit
);
