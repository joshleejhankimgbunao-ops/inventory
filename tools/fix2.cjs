const fs = require('fs');
const file = 'c:/Users/Allan/OneDrive/Desktop/inventory/src/pages/PointOfSale.jsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Remove the stock badges in size buttons
code = code.replace(/<button\s+disabled=\{!hasStock\}[\s\S]*?className=\{min-w-\[56px\][\s\S]*?\}\s*>[\s\S]*?<span>\{size\}<\/span>[\s\S]*?<span className=\{	ext-\[10px\] font-extrabold px-1\.5 py-0\.5 rounded-lg border[^]*\}>\{stockBadge\}<\/span>[\s\S]*?<\/button>/, 
    \<button
        disabled={!hasStock}
        onClick={() => { if(hasStock) setVariantModal(prev => ({ ...prev, selectedSize: isSelected ? null : size })) }}
        className={\\\min-w-[56px] px-4 py-2.5 text-sm font-bold rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-1 \\\\\\}
    >       
        <span>{size}</span>
    </button>\
);

// 2. Remove the stock badges in color buttons
code = code.replace(/<button\s+disabled=\{!hasStock\}[\s\S]*?className=\{px-5 py-2\.5 text-sm font-bold rounded-xl border-2[\s\S]*?\}\s*>[\s\S]*?<span>\{color\}<\/span>[\s\S]*?<span className=\{	ext-\[10px\] font-extrabold px-1\.5 py-0\.5 rounded-lg border[^]*\}>\{stockBadge\}<\/span>[\s\S]*?<\/button>/, 
    \<button
        disabled={!hasStock}
        onClick={() => { if(hasStock) setVariantModal(prev => ({ ...prev, selectedColor: isSelected ? null : color })) }}
        className={\\\px-5 py-2.5 text-sm font-bold rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-1 \\\\\\}
    >       
        <span>{color}</span>
    </button>\
);

// 3. Center the header content
code = code.replace(/<div className="px-6 py-5 border-b border-slate-100 bg-white\/70 backdrop-blur-xl flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 relative z-10">\s*<div className="flex-1">\s*<div className="flex flex-wrap items-center gap-2 mb-2">/, 
    \<div className="px-6 py-5 border-b border-slate-100 bg-white/70 backdrop-blur-xl flex flex-col items-center text-center gap-3 relative z-10 w-full">\n<div className="w-full flex flex-col items-center">\n<div className="flex flex-wrap justify-center items-center gap-2 mb-2">\);
    
// We also need to fix the alignment of the close button which is absolutely positioned
code = code.replace(/<button[\s\S]*?className="absolute top-5 right-6 sm:static[\s\S]*?>[\s\S]*?<\/button>/, 
    \<button\n    onClick={() => setVariantModal({ isOpen: false, group: null, step: 'brand', selectedBrand: null, selectedSize: null, selectedColor: null })}\n    className="absolute top-5 right-6 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-2 rounded-full transition-all"\n>\n    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>\n</button>\
);

// Make the product name centered actually 
code = code.replace(/<h3 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">/,
   \<h3 className="text-2xl font-black text-slate-900 tracking-tight leading-tight text-center w-full">\);

fs.writeFileSync(file, code);
