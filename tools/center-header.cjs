const fs = require('fs');
const file = 'c:/Users/Allan/OneDrive/Desktop/inventory/src/pages/PointOfSale.jsx';
let code = fs.readFileSync(file, 'utf8');

// Center the header
code = code.replace(
    /<div className="px-6 py-5 border-b border-slate-100 bg-white\/70 backdrop-blur-xl flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 relative z-10">/,
    '<div className="px-6 py-5 border-b border-slate-100 bg-white/70 backdrop-blur-xl flex flex-col items-center gap-4 relative z-10 text-center">'
);

// Center the brand spans
code = code.replace(
    /<div className="flex-1">\s*<div className="flex flex-wrap items-center gap-2 mb-2">/,
    '<div className="flex-1 w-full flex flex-col items-center">\n<div className="flex flex-wrap justify-center items-center gap-2 mb-2">'
);

// Close button positioning
code = code.replace(
    /<button[\s\S]*?className="absolute top-5 right-6 sm:static[\s\S]*?>/,
    '<button onClick={() => setVariantModal({ isOpen: false, group: null, step: \'brand\', selectedBrand: null, selectedSize: null, selectedColor: null })} className="absolute top-5 right-6 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-2 rounded-full transition-all">'
);

// Center the h3 text
code = code.replace(
    /<h3 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">/,
    '<h3 className="text-2xl font-black text-slate-900 tracking-tight leading-tight w-full text-center">'
);

// Fix the parseInt bug just in case
code = code.replace(/parseInt\((matchedVariant\.stock)\) <= 0/g, " <= 0");

fs.writeFileSync(file, code);
