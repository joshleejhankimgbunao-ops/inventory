/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loadCartSelection = () => import('../../src/utils/cartSelection.js');

const cart = [
  { code: 'SKU-001', qty: 2, price: 125 },
  { code: 'SKU-002', qty: 1, price: 85 },
  { code: 'SKU-003', qty: 4, price: 50 },
];

test('cart selection toggles one line without affecting cart quantities', async () => {
  const { toggleCartItemSelection } = await loadCartSelection();

  assert.deepEqual(toggleCartItemSelection([], 'SKU-001'), ['SKU-001']);
  assert.deepEqual(toggleCartItemSelection(['SKU-001'], 'SKU-001'), []);
  assert.deepEqual(toggleCartItemSelection(['SKU-001'], 'SKU-002'), ['SKU-001', 'SKU-002']);
  assert.equal(cart[0].qty, 2);
});

test('Select All selects current cart lines and toggles back to none', async () => {
  const { toggleAllCartItemSelections } = await loadCartSelection();

  const allSelected = toggleAllCartItemSelections(['SKU-001'], cart);
  assert.deepEqual(allSelected, ['SKU-001', 'SKU-002', 'SKU-003']);
  assert.deepEqual(toggleAllCartItemSelections(allSelected, cart), []);
});

test('bulk removal filters only selected current cart lines', async () => {
  const { removeSelectedCartItems } = await loadCartSelection();

  assert.deepEqual(
    removeSelectedCartItems(cart, ['SKU-001', 'SKU-003']).map((item) => item.code),
    ['SKU-002'],
  );
  assert.deepEqual(removeSelectedCartItems(cart, cart.map((item) => item.code)), []);
});

test('selected cart rows preserve duplicate product entries and their individual quantities', async () => {
  const { getSelectedCartItems } = await loadCartSelection();
  const rows = [
    { code: 'SKU-PAINT', name: 'Latex Paint', color: 'White', qty: 2 },
    { code: 'SKU-PAINT-BLUE', name: 'Latex Paint', color: 'Blue', qty: 1 },
    { code: 'SKU-PAINT', name: 'Latex Paint', color: 'White', qty: 3 },
  ];

  assert.deepEqual(getSelectedCartItems(rows, ['SKU-PAINT', 'SKU-PAINT-BLUE']), rows);
});

test('POS keeps selection controls opt-in and preserves the existing cart controls', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const cartPanel = source.slice(source.indexOf('/* Right Side: Cart / Order Summary */'), source.indexOf('/* Quotation Input Modal */'));
  const orderHeader = source.slice(source.indexOf('/* Current Order Header */'), source.indexOf('/* Cart List Management */'));
  const listManagement = source.slice(source.indexOf('/* Cart List Management */'), source.indexOf('/* Cart Item List */'));

  assert.doesNotMatch(orderHeader, />Select</);
  assert.doesNotMatch(orderHeader, /Credit Mode|Cash Mode/);
  assert.match(orderHeader, /pos-current-order-count rounded-full bg-slate-900 px-2 py-0\.5 text-\[10px\] font-medium text-slate-200/);
  assert.match(orderHeader, /\{cartItemCount\} items/);
  assert.match(listManagement, /\{cart\.length > 0 && \(/);
  assert.match(cartPanel, /onClick=\{\(\) => setIsCartSelectionMode\(true\)\}/);
  assert.match(cartPanel, /\{isCartSelectionMode && \(/);
  assert.match(cartPanel, /type="checkbox"/);
  assert.match(cartPanel, /onClick=\{\(event\) => handleCartItemClick\(event, item\.code\)\}/);
  assert.match(cartPanel, /onTouchStart=\{\(event\) => handleCartItemTouchStart\(event, item\.code\)\}/);
  assert.match(cartPanel, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(cartPanel, /data-pos-cart-item-remove onClick=\{\(event\) => \{ event\.stopPropagation\(\); requestSingleCartRemoval\(item, event\); \}\}/);
  assert.match(cartPanel, /item\.qty <= 1 \? requestSingleCartRemoval\(item, event\) : updateQuantity\(item\.code, item\.qty - 1\)/);
  assert.match(cartPanel, /onClick=\{\(\) => updateQuantity\(item\.code, item\.qty \+ 1\)\}/);
  assert.match(source, /title=\{`Remove \$\{selectedCartItemCount\} \$\{selectedCartItemCount === 1 \? 'item' : 'items'\}\?`\}/);
});

test('Current Order cards open read-only details for the exact cart SKU and ignore nested control activation', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const cartPanel = source.slice(source.indexOf('/* Right Side: Cart / Order Summary */'), source.indexOf('/* Quotation Input Modal */'));
  const cardClickHandler = source.slice(source.indexOf('const handleCartItemClick'), source.indexOf('const handleCartItemKeyDown'));
  const cardKeyHandler = source.slice(source.indexOf('const handleCartItemKeyDown'), source.indexOf('const preventMobileCartCardSelection'));
  const detailsModal = source.slice(source.indexOf('{productDetailsItem && !enlargedProductImage'), source.indexOf('{/* Recommendation Modal */'));

  assert.match(cartPanel, /data-pos-cart-item-card[\s\S]*?tabIndex=\{0\}[\s\S]*?role="group"[\s\S]*?focus-visible:ring-2/);
  assert.match(cardClickHandler, /if \(isCartSelectionMode\) \{\s*toggleCartSelection\(code\);\s*return;/);
  assert.match(cardClickHandler, /const item = cart\.find\(\(cartItem\) => cartItem\.code === code\)/);
  assert.match(cardClickHandler, /setProductDetailsItem\(item\)/);
  assert.match(cardKeyHandler, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(cardKeyHandler, /event\.target !== event\.currentTarget/);
  assert.match(detailsModal, /<ProductDetailsModalShell[\s\S]*?onClose=\{\(\) => setProductDetailsItem\(null\)\}/);
  assert.match(detailsModal, /backdropZIndexClassName=\{isCartDrawerOpen && isMobilePosLayout \? 'z-\[90\]' : 'z-50'\}/);
  assert.match(source, /getProductDetailsSpecifications\(productDetailsItem, categoryDefinitions\)/);
});

test('Current Order cards use the exact cart product image with a non-interactive compact thumbnail', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const cartPanel = source.slice(source.indexOf('/* Right Side: Cart / Order Summary */'), source.indexOf('/* Quotation Input Modal */'));
  const thumbnail = source.slice(source.indexOf('const ProductThumbnail ='), source.indexOf('const PosRecommendationReasons ='));
  const cartAddition = source.slice(source.indexOf('const getCartAdditionResult'), source.indexOf('const addToCart'));
  const quantityUpdate = source.slice(source.indexOf('const updateQuantity'), source.indexOf('const calculateTotal'));

  assert.match(source, /const getProductImageUrl = \(item\) => String\(item\?\.imageUrl \|\| ''\)\.trim\(\)/);
  assert.match(cartPanel, /<ProductThumbnail item=\{item\} className="h-12 w-12 rounded-lg" fit="contain" interactive=\{false\} \/>/);
  assert.match(cartPanel, /grid grid-cols-\[3rem_minmax\(0,1fr\)\] items-center gap-2\.5[\s\S]*?min-w-0 space-y-1\.5[\s\S]*?line-clamp-2[\s\S]*?title=\{item\.code\}/);
  assert.match(cartPanel, /pos-cart-item-controls[\s\S]*?formatCurrency\(item\.price \* item\.qty\)[\s\S]*?@ \{formatCurrency\(item\.price\)\}/);
  assert.match(cartPanel, /data-pos-cart-item-remove onClick=\{\(event\) => \{ event\.stopPropagation\(\); requestSingleCartRemoval/);
  assert.match(cartPanel, /onClick=\{\(event\) => event\.stopPropagation\(\)\} className="pos-cart-item-controls/);
  assert.match(thumbnail, /<RemoteProductImage\s+product=\{item\}/);
  assert.match(thumbnail, /onPreview=\{interactive \? onPreview : undefined\}/);
  assert.match(thumbnail, /decorative=\{!interactive\}/);
  assert.match(cartAddition, /\[\.\.\.previousCart, \{ \.\.\.product, qty: requestedQty \}\]/);
  assert.match(quantityUpdate, /item\.code === code \? \{ \.\.\.item, qty: newQty \}/);
  assert.match(cartPanel, /onClick=\{\(event\) => handleCartItemClick\(event, item\.code\)\}/);
  assert.match(cartPanel, /aria-label=\{isCartSelectionMode[\s\S]*?View product details for \$\{item\.name\}/);
});

test('selection-mode removal always opens confirmation for any nonempty selection', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const requestBulkRemove = source.slice(source.indexOf('const requestBulkRemove'), source.indexOf('const handlePaymentTypeChange'));

  assert.match(requestBulkRemove, /if \(selectedCartItemCount === 0\) return;\s*setIsBulkRemoveConfirmationOpen\(true\);/);
  assert.doesNotMatch(requestBulkRemove, /removeSelectedCartLines/);
  assert.match(source, /onClick=\{requestBulkRemove\}/);
  assert.match(source, /title=\{`Remove \$\{selectedCartItemCount\} \$\{selectedCartItemCount === 1 \? 'item' : 'items'\}\?`\}/);
  assert.match(source, /onConfirm=\{removeSelectedCartLines\}/);
});

test('bulk remove confirmation lists each selected cart entry and its quantity', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const confirmationComponent = fs.readFileSync(path.resolve(__dirname, '../../src/components/CartRemovalConfirmation.jsx'), 'utf8');
  const confirmation = source.slice(source.indexOf('{isBulkRemoveConfirmationOpen &&'), source.indexOf('<button\n            ref={floatingCartButtonRef}'));

  assert.match(source, /const selectedCartItems = getSelectedCartItems\(cart, selectedCartItemCodes\)/);
  assert.match(source, /const selectedCartItemCount = selectedCartItems\.length/);
  assert.match(confirmation, /selectedCartItems\.map\(\(item, index\)/);
  assert.match(confirmation, /items=\{items\}/);
  assert.match(confirmationComponent, /item\.name \|\| 'Unnamed product'/);
  assert.match(confirmationComponent, /SKU: \{item\.sku\}/);
  assert.match(confirmationComponent, /Qty \{item\.quantity\}/);
  assert.match(confirmationComponent, /maxHeight: 'min\(40vh, calc\(100dvh - 12rem\)\)'/);
  assert.match(confirmationComponent, />\s*Cancel\s*</);
  assert.match(confirmationComponent, />\s*Remove\s*</);
});

test('individual Current Order removals require product-specific confirmation', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const confirmationComponent = fs.readFileSync(path.resolve(__dirname, '../../src/components/CartRemovalConfirmation.jsx'), 'utf8');
  const requestRemoval = source.slice(source.indexOf('const requestSingleCartRemoval'), source.indexOf('const handleSingleCartRemovalDialogKeyDown'));
  const confirmation = source.slice(source.indexOf('{pendingCartRemoval && (() => {'), source.indexOf('{isBulkRemoveConfirmationOpen && (() => {'));

  assert.match(requestRemoval, /singleCartRemovalLockedRef\.current/);
  assert.match(requestRemoval, /setPendingCartRemoval\(\{ code: item\.code, item \}\)/);
  assert.match(requestRemoval, /filter\(\(item\) => item\.code !== code\)/);
  assert.match(confirmation, /CartRemovalConfirmation/);
  assert.match(confirmation, /title="Remove this item\?"/);
  assert.match(confirmation, /quantity: item\?\.qty/);
  assert.match(confirmation, /onConfirm=\{confirmSingleCartRemoval\}/);
  assert.match(confirmation, /closeOnBackdrop/);
  assert.match(confirmation, /onKeyDown=\{handleSingleCartRemovalDialogKeyDown\}/);
  assert.match(confirmationComponent, /role="alertdialog"/);
  assert.match(confirmationComponent, /closeOnBackdrop && event\.target === event\.currentTarget\) onCancel\(\)/);
  assert.match(confirmationComponent, />\s*Cancel\s*</);
  assert.match(confirmationComponent, />\s*Remove\s*</);
  assert.match(source, /event\.key === 'Escape'[\s\S]*?closeSingleCartRemoval\(\)/);
});

test('desktop Current Order collapses in place and keeps an accessible cart toggle', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const tooltip = fs.readFileSync(path.resolve(__dirname, '../../src/components/ViewportTooltip.jsx'), 'utf8');
  const currentOrder = source.slice(source.indexOf('/* Right Side: Cart / Order Summary */'), source.indexOf('/* Quotation Input Modal */'));

  assert.match(source, /const \[isCurrentOrderCollapsed, setIsCurrentOrderCollapsed\] = useState\(false\)/);
  assert.match(source, /isInlineCartPanelCollapsed = isCurrentOrderCollapsed && !isMobilePosLayout/);
  assert.match(currentOrder, /id="pos-current-order-shell"[\s\S]*?md:transition-\[width,transform\][\s\S]*?md:w-11' : 'md:w-96'/);
  assert.match(currentOrder, /md:transition-transform[\s\S]*?md:translate-x-full' : 'md:translate-x-0'/);
  assert.match(currentOrder, /aria-controls="pos-current-order-panel"[\s\S]*?aria-expanded="false"/);
  assert.match(currentOrder, /aria-controls="pos-current-order-panel"[\s\S]*?aria-expanded="true"/);
  assert.match(currentOrder, /content="Current Order"[\s\S]*?<PosNavigationCartIcon \/>/);
  assert.match(currentOrder, /content="Hide Current Order"[\s\S]*?placementPreference="left"[\s\S]*?openDelay=\{140\}[\s\S]*?closeDelay=\{80\}[\s\S]*?animateAppearance/);
  assert.match(currentOrder, /aria-label=\{`Show Current Order, \$\{cartItemCount\} items`\}/);
  assert.match(currentOrder, /aria-label="Hide Current Order"/);
  assert.match(currentOrder, /role="group"[\s\S]*?aria-label="Current Order actions"/);
  assert.match(currentOrder, /pos-current-order-header[\s\S]*?Current Order[\s\S]*?\{cartItemCount\} items/);
  assert.match(currentOrder, /aria-hidden=\{isInlineCartPanelCollapsed/);
  assert.match(currentOrder, /id="pos-current-order-panel"[\s\S]*?cart\.map\(item =>/);
  assert.match(tooltip, /onFocusCapture=\{\(event\) => \{\s*if \(event\.target\.matches\?\.\(':focus-visible'\)\) openTooltip\(0\);\s*\}\}/);
  assert.match(tooltip, /onMouseLeave=\{\(\) => \{\s*pointerAnchorRef\.current = null;\s*pointerCoordinatesRef\.current = null;[\s\S]*?const activeElement = document\.activeElement;[\s\S]*?activeElement\?\.matches\?\.\(':focus-visible'\);\s*if \(!hasKeyboardFocus\) closeTooltip\(\);/);
  assert.match(tooltip, /className=\{`fixed pointer-events-none z-\[100\]/);
  assert.match(tooltip, /role="tooltip"/);
  const tooltipMarkup = tooltip.slice(tooltip.indexOf('role="tooltip"'), tooltip.indexOf('document.body'));
  assert.doesNotMatch(tooltipMarkup, /onMouse(?:Enter|Leave)=/);
  assert.match(tooltip, /placement === 'left' \? '-right-1'/);
  assert.match(tooltip, /createPortal\([\s\S]*?document\.body/);
});

test('collapsed Current Order rail reuses the sidebar cart icon and anchors its tooltip to its control', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Dashboard.jsx'), 'utf8');
  const pos = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const icon = fs.readFileSync(path.resolve(__dirname, '../../src/components/PosNavigationCartIcon.jsx'), 'utf8');
  const tooltip = fs.readFileSync(path.resolve(__dirname, '../../src/components/ViewportTooltip.jsx'), 'utf8');
  const currentOrder = pos.slice(pos.indexOf('/* Right Side: Cart / Order Summary */'), pos.indexOf('/* Quotation Input Modal */'));
  const header = currentOrder.slice(currentOrder.indexOf('/* Current Order Header */'), currentOrder.indexOf('/* Cart List Management */'));

  assert.match(dashboard, /name: 'Point of Sale'[\s\S]*?icon: <PosNavigationCartIcon \/>/);
  assert.match(pos, /import PosNavigationCartIcon from '\.\.\/components\/PosNavigationCartIcon'/);
  assert.match(icon, /className="w-5 h-5"[\s\S]*?M3 3h2l\.4 2M7 13h10l4-8H5\.4/);
  assert.match(header, /<PosNavigationCartIcon \/>/);
  assert.doesNotMatch(header, /strokeWidth=\{1\.8\}/);
  assert.match(currentOrder, /content="Current Order" maxWidth=\{180\} placementPreference="left" triggerGap=\{10\} openDelay=\{140\} closeDelay=\{80\} animateAppearance/);
  assert.match(currentOrder, /<PosNavigationCartIcon \/>/);
  assert.match(currentOrder, /aria-label=\{`Current Order, \$\{cartItemCount\} items`\}[\s\S]*?<PosNavigationCartIcon \/>[\s\S]*?aria-live="polite">\{cartItemCount\}/);
  assert.match(currentOrder, /content="Current Order"[\s\S]*?aria-label=\{`Show Current Order, \$\{cartItemCount\} items`\}/);
  assert.doesNotMatch(currentOrder, /pointerAnchorSelector=/);
  assert.match(tooltip, /onFocusCapture=\{\(event\) => \{\s*if \(event\.target\.matches\?\.\(':focus-visible'\)\) openTooltip\(0\);/);
  assert.match(tooltip, /className=\{`fixed pointer-events-none z-\[100\]/);
  assert.match(tooltip, /createPortal\([\s\S]*?document\.body/);
});

test('collapsed Current Order rail exposes existing quotation and review actions without toggling the rail', () => {
  const pos = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const icons = fs.readFileSync(path.resolve(__dirname, '../../src/components/RecordActionIcon.jsx'), 'utf8');
  const currentOrder = pos.slice(pos.indexOf('/* Right Side: Cart / Order Summary */'), pos.indexOf('/* Quotation Input Modal */'));
  const quotation = currentOrder.indexOf('content="Prepare Quotation"');
  const review = currentOrder.indexOf('content="Review Order"');
  const expand = currentOrder.indexOf('content="Show Current Order"', currentOrder.indexOf('content="Review Order"'));

  assert.ok(quotation >= 0 && review > quotation && expand > review);
  assert.match(currentOrder, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); runCartAction\(handleGenerateQuotation\); \}\}[\s\S]*?disabled=\{cart\.length === 0\}[\s\S]*?aria-label="Prepare Quotation"/);
  assert.match(currentOrder, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); runCartAction\(openOrderList\); \}\}[\s\S]*?disabled=\{isCheckoutDisabled\}[\s\S]*?aria-label="Review Order"/);
  assert.match(currentOrder, /<RecordActionIcon name="file-plus" className="h-5 w-5 shrink-0" \/>/);
  assert.match(currentOrder, /<RecordActionIcon name="clipboard-check" className="h-5 w-5 shrink-0" \/>/);
  assert.match(icons, /'file-plus':/);
  assert.match(icons, /'clipboard-check':/);
  assert.match(currentOrder, /runCartAction\(handleGenerateQuotation\)/);
  assert.match(currentOrder, /runCartAction\(openOrderList\)/);
  assert.match(currentOrder, /if \(!event\.target\.closest\?\.\('\[data-current-order-rail-action\]'\)\) setIsCurrentOrderCollapsed\(false\)/);
  assert.match(currentOrder, /data-current-order-rail-action/);
});

test('collapsed POS product grid auto-fits columns from its catalog container width', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');

  assert.match(source, /pos-product-list min-w-0 flex-1 overflow-y-auto/);
  assert.match(source, /pos-product-grid grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 \$\{isInlineCartPanelCollapsed \? 'pos-product-grid-collapsed' : 'lg:grid-cols-4'\}/);
  assert.match(source, /pos-current-order overflow-hidden[^\n]*md:w-96/);
  assert.match(source, /isInlineCartPanelCollapsed \? 'md:w-11' : 'md:w-96'/);
  assert.match(source, /absolute inset-y-0 left-0 z-20 w-96 md:transform-gpu/);
  assert.doesNotMatch(source, /lg:grid-cols-4 2xl:grid-cols-5/);
  assert.match(styles, /\.pos-product-list\s*\{\s*container-name:\s*pos-product-catalog;\s*container-type:\s*inline-size;/);
  assert.match(styles, /\.pos-product-grid-collapsed\s*\{\s*--pos-product-grid-card-width:\s*max\(9\.5rem, calc\(\(100cqw - 312px\) \/ 3\)\);\s*grid-template-columns:\s*repeat\(auto-fill, minmax\(var\(--pos-product-grid-card-width\), 1fr\)\);/);
  assert.match(styles, /@media \(min-width: 1024px\)[\s\S]*?--pos-product-grid-card-width:\s*max\(9\.5rem, calc\(\(100cqw - 344px\) \/ 4\)\)/);
  assert.match(styles, /@media \(min-width: 1536px\)[\s\S]*?--pos-product-grid-card-width:\s*max\(9\.5rem, calc\(\(100cqw - 354px\) \/ 5\)\)/);
  assert.match(styles, /@container pos-product-catalog \(min-width: 78rem\)[\s\S]*?grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
});

test('mobile Cart drawer reuses the inline cart and keeps its list and footer independent', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const currentOrder = source.slice(source.indexOf('/* Right Side: Cart / Order Summary */'), source.indexOf('/* Quotation Input Modal */'));
  const styles = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');

  assert.match(source, /const cartItemCount = cart\.reduce\(\(total, item\) => total \+ item\.qty, 0\)/);
  assert.match(source, /aria-label=\{`Open cart, \$\{cartItemCount\} item/);
  assert.match(source, /import \{ createPortal \} from 'react-dom'/);
  assert.match(currentOrder, /createPortal\([\s\S]*?document\.body/);
  assert.match(currentOrder, /fixed inset-0 z-\[79\]/);
  assert.match(currentOrder, /id="pos-current-order-panel"/);
  assert.match(currentOrder, /role=\{isCartDrawerOpen && isMobilePosLayout \? 'dialog' : undefined\}/);
  assert.match(currentOrder, /'hidden md:flex md:bg-slate-50\/80'/);
  assert.match(currentOrder, /pos-current-order-mobile-drawer fixed inset-0 z-\[80\]/);
  assert.match(currentOrder, /pos-cart-management[^\n]*bg-white[^\n]*md:bg-slate-50\/80/);
  assert.match(currentOrder, /pos-cart-list min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white/);
  assert.match(currentOrder, /pos-checkout-panel[^\n]*bg-white[^\n]*md:bg-slate-50\/80/);
  assert.match(currentOrder, /runCartAction\(handleGenerateQuotation\)/);
  assert.match(currentOrder, /runCartAction\(openOrderList\)/);
  assert.match(styles, /\.pos-current-order-mobile-drawer\s*\{\s*box-sizing: border-box;\s*height: 100vh;/);
  assert.match(styles, /@supports \(height: 100dvh\)[\s\S]*?\.pos-current-order-mobile-drawer\s*\{\s*height: 100dvh;/);
  assert.match(source, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(source, /aria-label="Close Current Order"/);
});

test('bulk remove confirmation remains layered above the portaled mobile Cart drawer', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const confirmation = source.slice(source.indexOf('{isBulkRemoveConfirmationOpen &&'), source.indexOf('<button\n            ref={floatingCartButtonRef}'));

  assert.match(confirmation, /createPortal\(confirmation, document\.body\)/);
  assert.match(confirmation, /z-\[90\]/);
});

test('floating mobile Cart follows the header trigger and reuses the same drawer action', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');

  assert.match(source, /new IntersectionObserver\(\(\[entry\]\)/);
  assert.match(source, /observer\.observe\(headerCartButton\)/);
  assert.match(source, /const isFloatingCartVisible = isMobilePosLayout\s*&& !isHeaderCartVisible\s*&& !isCartDrawerOpen\s*&& !isBlockingPosModalOpen/);
  assert.match(source, /isBulkRemoveConfirmationOpen[\s\S]*recommendationModal\.isOpen[\s\S]*productDetailsItem[\s\S]*checkoutPhase/);
  assert.match(source, /ref=\{floatingCartButtonRef\}[\s\S]*onClick=\{openCartDrawer\}[\s\S]*aria-label=\{`Open cart, \$\{cartItemCount\} item/);
  assert.match(source, /bottom: 'calc\(env\(safe-area-inset-bottom, 0px\) \+ 1rem\)'/);
  assert.match(source, /right: 'calc\(env\(safe-area-inset-right, 0px\) \+ 1rem\)'/);
  assert.match(source, /motion-reduce:transition-none md:hidden/);
  assert.match(source, /aria-hidden=\{!isFloatingCartVisible\}[\s\S]*tabIndex=\{isFloatingCartVisible \? 0 : -1\}[\s\S]*disabled=\{!isFloatingCartVisible\}/);
});

test('mobile long press uses the existing multi-select handler and cancels scrolling/control gestures', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');

  assert.match(source, /matchMedia\('\(max-width: 767px\)'\)[\s\S]*?matchMedia\('\(pointer: coarse\)'\)/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?setIsCartSelectionMode\(true\);\s*toggleCartSelection\(code\);[\s\S]*?\}, 500\)/);
  assert.match(source, /event\.target\)\) return;/);
  assert.match(source, /Math\.hypot\(deltaX, deltaY\) > 12/);
  assert.match(source, /onTouchCancel=\{handleCartItemTouchEnd\}/);
  assert.match(source, /suppression\.code === code[\s\S]*?event\.preventDefault\(\)/);
  assert.match(source, /if \(isCartSelectionMode\) \{\s*toggleCartSelection\(code\);\s*return;/);
});
