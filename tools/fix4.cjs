const fs = require('fs');
const file = 'c:/Users/Allan/OneDrive/Desktop/inventory/src/pages/PointOfSale.jsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/\) :  <= 0 \? \(/g, ") : matchedVariant.stock <= 0 ? (");
code = code.replace(/\(!matchedVariant \|\|  <= 0\)/g, "(!matchedVariant || matchedVariant.stock <= 0)");

fs.writeFileSync(file, code);
