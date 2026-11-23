export const calculateActiveInventorySellingValue = (products) => {
    if (!Array.isArray(products)) return 0;

    return products.reduce((total, product) => {
        // Product Master List treats only an explicit false isActive as archived.
        if (product?.isActive === false) return total;

        const price = Number(product?.price || 0);
        const stock = Number(product?.stock || 0);
        if (!Number.isFinite(price) || !Number.isFinite(stock)) return total;

        // `stock` is physical on-hand quantity; reserved stock remains included.
        return total + (price * stock);
    }, 0);
};
