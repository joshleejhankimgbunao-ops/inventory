const normalizeCodes = (codes = []) => Array.from(new Set(codes.filter(Boolean)));

export const toggleCartItemSelection = (selectedCodes, code) => {
    const currentCodes = normalizeCodes(selectedCodes);

    return currentCodes.includes(code)
        ? currentCodes.filter((selectedCode) => selectedCode !== code)
        : [...currentCodes, code];
};

export const toggleAllCartItemSelections = (selectedCodes, cartItems) => {
    const cartCodes = normalizeCodes((cartItems || []).map((item) => item?.code));
    const selectedCartCodes = normalizeCodes(selectedCodes).filter((code) => cartCodes.includes(code));

    return selectedCartCodes.length === cartCodes.length ? [] : cartCodes;
};

export const removeSelectedCartItems = (cartItems, selectedCodes) => {
    const selectedCodeSet = new Set(normalizeCodes(selectedCodes));
    return (cartItems || []).filter((item) => !selectedCodeSet.has(item?.code));
};
