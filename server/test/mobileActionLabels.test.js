/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

test('mobile record and directory actions pair icons with visible labels without changing desktop table actions', () => {
  const products = read('../../src/pages/ProductList.jsx');
  const variants = read('../../src/components/ProductFamilyModal.jsx');
  const users = read('../../src/pages/UserList.jsx');
  const partners = read('../../src/pages/Partners.jsx');
  const settings = read('../../src/pages/Settings.jsx');

  assert.match(products, /Product Master List mobile records[\s\S]*Manage Variants/);
  assert.match(products, /hidden md:block[\s\S]*main-data-table/);
  assert.match(variants, /md:hidden[\s\S]*Edit Variant[\s\S]*Restore[\s\S]*Archive/);
  assert.match(variants, /<dt className="text-\[10px\] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">\{definition\.name\}<\/dt>/);
  assert.match(variants, /<dd className="mt-0\.5 break-words text-xs font-normal text-slate-700 dark:text-slate-200">\{value\}<\/dd>/);
  assert.match(users, /User Management mobile records[\s\S]*<span>Edit<\/span>[\s\S]*<span>Archive<\/span>[\s\S]*<span>Restore<\/span>/);
  assert.match(partners, /<span className="ml-1 md:hidden">Restock Plan<\/span>[\s\S]*<span className="mr-1 md:hidden">Restore<\/span>[\s\S]*<span className="ml-1 md:hidden">Edit<\/span>[\s\S]*<span className="ml-1 md:hidden">Archive<\/span>/);
  assert.match(settings, /<span className="ml-1 md:hidden">Edit<\/span>[\s\S]*<span className="ml-1 md:hidden">\{category\.isActive === false \? 'Restore' : 'Archive'\}<\/span>/);
});

test('mobile recommendation review and POS card controls expose action names beside their icons', () => {
  const recommendations = read('../../src/pages/Recommendation.jsx');
  const pos = read('../../src/pages/PointOfSale.jsx');
  const attributes = read('../../src/components/CategoryAttributesEditor.jsx');
  const styles = read('../../src/index.css');

  assert.match(recommendations, /mt-2 flex flex-wrap gap-1\.5 md:hidden[\s\S]*View Details[\s\S]*Remove/);
  assert.match(recommendations, /<span className="md:hidden">Details<\/span>/);
  assert.match(pos, /aria-label=\{`Remove \$\{item\.name\} from order`\}[\s\S]*<span className="md:hidden">Remove<\/span>/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*aria-labelledby="order-list-title"\] button\[aria-label\^="Remove "\][\s\S]*content: "Remove"/);
  assert.match(attributes, /<span className="md:hidden"> Move up<\/span>[\s\S]*<span className="md:hidden"> Move down<\/span>/);
});
