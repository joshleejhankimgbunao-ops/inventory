const fs = require('fs');
const file = 'c:/Users/Allan/OneDrive/Desktop/inventory/src/pages/PointOfSale.jsx';
let code = fs.readFileSync(file, 'utf8');

// Patch sizes
code = code.replace(
    /\{uniqueSizes\.map\(size => \{[\s\S]*?return\s*\([\s\S]*?<div key=\{size\}[\s\S]*?<\/div>\s*\)\s*\}\)\}/,
    `{uniqueSizes.map(size => {
        const isSelected = variantModal.selectedSize === size;
        const variantsForSize = filteredVariants.filter(v => v.size === size && (!needsColor || v.color === variantModal.selectedColor || !hasSelectedColor));
        const totalStock = variantsForSize.reduce((sum, v) => sum + parseInt(v.stock || 0, 10), 0);
        const hasStock = totalStock > 0;
        const stockBadge = !hasStock ? 'Sold Out' : (totalStock <= 15 ? \`\${totalStock} left\` : \`\${totalStock} in stock\`);
        const stockColorClass = !hasStock ? 'text-rose-500 bg-rose-50 border-rose-100' : (totalStock <= 15 ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-emerald-600 bg-emerald-50 border-emerald-100');

        return (
            <div key={size} className={\`relative group \${!hasStock ? 'cursor-not-allowed' : ''}\`}>
                <button
                    disabled={!hasStock}
                    onClick={() => { if(hasStock) setVariantModal(prev => ({ ...prev, selectedSize: isSelected ? null : size })) }}
                    className={\`min-w-[56px] px-4 py-2.5 text-sm font-bold rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-1 \${isSelected ? 'border-slate-900 bg-slate-900 text-white shadow-md scale-105' : hasStock ? 'border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 bg-white hover:shadow-sm hover:-translate-y-0.5' : 'border-slate-100 text-slate-400 bg-slate-50 cursor-not-allowed opacity-60 pointer-events-none'}\`}
                >       
                    <span>{size}</span>
                    <span className={\`text-[10px] font-extrabold px-1.5 py-0.5 rounded-lg border \${isSelected ? (hasStock ? 'bg-white/20 text-white border-transparent' : 'bg-rose-500/20 text-white border-transparent') : stockColorClass}\`}>{stockBadge}</span>
                </button>
            </div>
        )
    })}`
);

// Patch colors
code = code.replace(
    /\{uniqueColors\.map\(color => \{[\s\S]*?return\s*\([\s\S]*?<div key=\{color\}[\s\S]*?<\/div>\s*\)\s*\}\)\}/,
    `{uniqueColors.map(color => {
        const isSelected = variantModal.selectedColor === color;
        const variantsForColor = filteredVariants.filter(v => v.color === color && (!needsSize || v.size === variantModal.selectedSize || !hasSelectedSize));
        const totalStock = variantsForColor.reduce((sum, v) => sum + parseInt(v.stock || 0, 10), 0);
        const hasStock = totalStock > 0;
        const stockBadge = !hasStock ? 'Sold Out' : (totalStock <= 15 ? \`\${totalStock} left\` : \`\${totalStock} in stock\`);
        const stockColorClass = !hasStock ? 'text-rose-500 bg-rose-50 border-rose-100' : (totalStock <= 15 ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-emerald-600 bg-emerald-50 border-emerald-100');

        return (
            <div key={color} className={\`relative group \${!hasStock ? 'cursor-not-allowed' : ''}\`}>
                <button
                    disabled={!hasStock}
                    onClick={() => { if(hasStock) setVariantModal(prev => ({ ...prev, selectedColor: isSelected ? null : color })) }}
                    className={\`px-5 py-2.5 text-sm font-bold rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-1 \${isSelected ? 'border-slate-900 bg-slate-900 text-white shadow-md scale-105' : hasStock ? 'border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 bg-white hover:shadow-sm hover:-translate-y-0.5' : 'border-slate-100 text-slate-400 bg-slate-50 cursor-not-allowed opacity-60 pointer-events-none'}\`}
                >       
                    <span>{color}</span>
                    <span className={\`text-[10px] font-extrabold px-1.5 py-0.5 rounded-lg border \${isSelected ? (hasStock ? 'bg-white/20 text-white border-transparent' : 'bg-rose-500/20 text-white border-transparent') : stockColorClass}\`}>{stockBadge}</span>
                </button>
            </div>
        )
    })}`
);

// Patch Add to Cart logic
code = code.replace(
    /const matchedVariant = isAllSelected \? filteredVariants\.find\([\s\S]*?\) : null;/,
    "const matchedVariant = isAllSelected ? filteredVariants.find(v => (!needsColor || v.color === variantModal.selectedColor) && (!needsSize || v.size === variantModal.selectedSize)) || filteredVariants[0] : null;"
);

// Patch condition
code = code.replace(/parseInt\(matchedVariant\.stock\) <= 0/g, "matchedVariant.stock <= 0");


fs.writeFileSync(file, code);
