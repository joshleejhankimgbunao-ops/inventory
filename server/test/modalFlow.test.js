const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (relativePath) => fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');

test('Sale Details hides while a preserved child modal is active', () => {
  const history = source('src/pages/History.jsx');

  assert.match(history, /const isSaleDetailsChildActive = Boolean\([\s\S]*?isEditingSaleReference[\s\S]*?isCorrectingSaleReference[\s\S]*?isVoidModalOpen[\s\S]*?documentPreview/);
  assert.match(history, /\{selectedSaleDetails && !isSaleDetailsChildActive && \(/);
  assert.match(history, /\{isVoidModalOpen && selectedSaleDetails && \(/);
});

test('Product Family transitions hide Manage Variants and restore it after the child form closes', () => {
  const productList = source('src/pages/ProductList.jsx');
  const addVariant = productList.slice(
    productList.indexOf('const handleOpenAddVariant = (family) => {'),
    productList.indexOf('const handleOpenVariantEdit =', productList.indexOf('const handleOpenAddVariant = (family) => {')),
  );
  const closeForm = productList.slice(
    productList.indexOf('const handleCloseProductForm ='),
    productList.indexOf('const handleOpenAddVariant =', productList.indexOf('const handleCloseProductForm =')),
  );

  assert.match(addVariant, /setIsFamilyModalOpen\(false\)/);
  assert.match(closeForm, /setIsFamilyModalOpen\(true\)/);
  assert.match(productList, /\{isModalOpen && !isCategoryChangeOpen && \(/);
  assert.match(productList, /\{isCategoryChangeOpen && editingProduct && \(/);
});

test('quotation and Credit child dialogs render without their parent modal', () => {
  const pointOfSale = source('src/pages/PointOfSale.jsx');
  const creditTransactions = source('src/pages/CreditTransactions.jsx');

  assert.match(pointOfSale, /setShowQuotationTypeChooser\(false\)[\s\S]*?setShowQuotationCustomerSelector\(true\)/);
  assert.match(pointOfSale, /setShowQuotationCustomerSelector\(false\)[\s\S]*?setShowQuotationDetails\(true\)/);
  assert.match(pointOfSale, /const returnToQuotationCustomerSelector = \(\) => \{[\s\S]*?setShowQuotationDetails\(false\)[\s\S]*?setShowQuotationCustomerSelector\(true\)/);
  assert.match(pointOfSale, /setFormalQuotationData\(null\);\s*setShowQuotationDetails\(true\)/);
  assert.match(creditTransactions, /\{isDetailsOpen && selectedRecord && !creditReceiptPreview && !proofLightbox && \(/);
  assert.match(creditTransactions, /\{isMarkPaidModalOpen && markPaidTarget && !isCancelModalOpen && \(/);
  assert.match(creditTransactions, /setIsCancelModalOpen\(false\);\s*setIsCancelConfirmOpen\(false\);/);
});
