import React, { useState, useMemo, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { showToast } from '../utils/toastHelper';
import { getAlternatives, getBudgetTierByPrice, getLowStockThreshold, getStockStatus } from '../utils/recommendationLogic';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { getAuthToken } from '../services/apiClient';
import { createSaleApi, listProductsApi } from '../services/inventoryApi';

const PointOfSale = () => {
    const { processedInventory: inventory, setInventory, transactions, setTransactions, logAction, logActivity, addToSyncQueue, syncQueue, isOnline } = useInventory();
    const { appSettings: settings, currentUserName } = useAuth();

    const showErrorDetails = (message) => {
        showToast("Action Failed", message, "error", "pos-action-error");
    };

    const formatCurrency = (value) => `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const getTierDisplayLabel = (tier) => {
        if (tier === 'low') return 'Value';
        if (tier === 'moderate') return 'Standard';
        if (tier === 'high') return 'Premium';
        return 'Standard';
    };
    const getRelativeTierKey = (candidatePrice, selectedPrice) => {
        const basePrice = Number(selectedPrice || 0);
        const altPrice = Number(candidatePrice || 0);

        // Fallback to global tiering when selected price is invalid.
        if (!Number.isFinite(basePrice) || basePrice <= 0) {
            return getBudgetTierByPrice(altPrice, settings);
        }

        // Use +/-10% with a minimum absolute band to avoid over-sensitivity on low-priced items.
        const toleranceBand = Math.max(basePrice * 0.1, 20);
        const delta = altPrice - basePrice;

        if (delta < -toleranceBand) return 'low';
        if (delta > toleranceBand) return 'high';
        return 'moderate';
    };

    const [cart, setCart] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [recommendationModal, setRecommendationModal] = useState({ isOpen: false, item: null, alternatives: [], budgetOptions: null }); // Recommendation Modal State
    
    // Payment State
    const [cashAmount, setCashAmount] = useState(''); // Use string for input handling
    const [isCheckoutProcessing, setIsCheckoutProcessing] = useState(false);
    const checkoutInFlightRef = useRef(false);
    
    // Quotation State
    const [showQuotationInput, setShowQuotationInput] = useState(false);
    const [quotationCustomerName, setQuotationCustomerName] = useState('');
    const [showQuotationPreview, setShowQuotationPreview] = useState(false);
    const [quotationData, setQuotationData] = useState(null);

    // Receipt Modal State
    const [showReceipt, setShowReceipt] = useState(false);
    const [lastTransaction, setLastTransaction] = useState(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 16;

    const [variantModal, setVariantModal] = useState({ isOpen: false, group: null, step: 'brand', selectedBrand: null, selectedSize: null, selectedColor: null });

    // Filter products based on search and category
    const filteredProducts = useMemo(() => {
        const filtered = inventory.filter(item => {
            // Exclude archived items in POS
            if (item.isArchived) return false;

            const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                (item.brand || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                                (item.color || '').toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
            return matchesSearch && matchesCategory;
        });

        const groups = {};
        filtered.forEach(item => {
            // Group solely by Category and Name, allowing brands, sizes, colors, and other variations to be grouped together
            const key = `${item.category || ''}|${item.name || ''}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        });

        const result = [];
        Object.values(groups).forEach(variants => {
            if (variants.length === 1) {
                result.push(variants[0]);
            } else {
                const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
                const prices = variants.map(v => v.price);
                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                const sample = variants[0];
                
                // Determine color text: if all same color, show it; if multiple, say "Multiple Colors"; otherwise null
                const uniqueColors = new Set(variants.map(v => v.color).filter(Boolean));
                const displayColor = uniqueColors.size === 1 ? [...uniqueColors][0] : (uniqueColors.size > 1 ? 'Multiple Colors' : null);
                
                // Determine brand text: if all same brand, show it; if multiple, say "Multiple Brands"
                const uniqueBrands = new Set(variants.map(v => v.brand).filter(Boolean));
                const displayBrand = uniqueBrands.size === 1 ? [...uniqueBrands][0] : (uniqueBrands.size > 1 ? 'Multiple Brands' : null);

                result.push({
                    isGroup: true,
                    code: `group-${sample.code}`, // unique key alias so map key works
                    name: sample.name,
                    brand: displayBrand,
                    color: displayColor,
                    category: sample.category,
                    stock: totalStock,
                    minPrice,
                    maxPrice,
                    availableBrands: [...uniqueBrands],
                    variants: [...variants].sort((a, b) => (a.brand || '').localeCompare(b.brand || '') || a.price - b.price || (a.size || '').localeCompare(b.size || '') || (a.color || '').localeCompare(b.color || ''))
                });
            }
        });
        
        // Sort: Low/Out of Stock first (ascending stock)
        return result.sort((a, b) => a.stock - b.stock);
    }, [inventory, searchQuery, selectedCategory]);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, selectedCategory]);

    useEffect(() => {
        if (cart.length === 0 && cashAmount !== '') {
            setCashAmount('');
        }
    }, [cart.length, cashAmount]);

    // Get current items
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

    // Derived categories
    const categories = ['All', ...Array.from(new Set(inventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];

    const addToCart = (product, forceAdd = false, options = {}) => {
        const silentNotification = Boolean(options?.silentNotification);
        if (!forceAdd) {
            const alts = getAlternatives(product, inventory, settings, { maxSuggestions: 8 });
            const lowThreshold = Math.max(1, Number(getLowStockThreshold(product, settings)) || 10);

            if (product.stock <= 0) {
                setRecommendationModal({ isOpen: true, item: product, alternatives: alts, budgetOptions: null, type: 'out-of-stock' });
                return;
            }

            if (product.stock <= lowThreshold) {
                setRecommendationModal({ isOpen: true, item: product, alternatives: alts, budgetOptions: null, type: 'low-stock' });
                return;
            }
        }

        setCart(prevCart => {
            const existingItem = prevCart.find(item => item.code === product.code);
            
            // Check if adding one more exceeds stock
            const currentQtyInCart = existingItem ? existingItem.qty : 0;
            if (currentQtyInCart + 1 > product.stock) {
                showErrorDetails(`Only ${product.stock} units available!`);
                return prevCart;
            }

            if (existingItem) {
                return prevCart.map(item => 
                    item.code === product.code 
                        ? { ...item, qty: item.qty + 1 } 
                        : item
                );
            } else {
                return [...prevCart, { ...product, qty: 1 }];
            }
        });

        if (forceAdd) {
            setRecommendationModal({ isOpen: false, item: null, alternatives: [], budgetOptions: null });
            if (!silentNotification) {
                showToast("Item Added", "Item added to cart.", "success", "pos-add-cart");
            }
        }
    };

    const openBudgetAlternatives = (product) => {
        const alts = getAlternatives(product, inventory, settings, { maxSuggestions: 8 });
        if (alts.length === 0) {
            showToast("No Alternatives", "No alternatives found for this item.", "info", "pos-budget-no-alternatives");
            return;
        }

        setRecommendationModal({ isOpen: true, item: product, alternatives: alts, budgetOptions: null, type: 'in-stock' });
    };

    const removeFromCart = (code) => {
        setCart(prevCart => prevCart.filter(item => item.code !== code));
    };

    const updateQuantity = (code, newQty) => {
        if (newQty <= 0) {
            removeFromCart(code);
            return;
        }

        const product = inventory.find(i => i.code === code);
        if (!product) return;

        if (newQty > product.stock) {
            showErrorDetails(`Only ${product.stock} units available!`);
            return;
        }

        setCart(prevCart => prevCart.map(item => 
            item.code === code ? { ...item, qty: newQty } : item
        ));
    };

    const calculateTotal = () => {
        return cart.reduce((total, item) => total + (item.price * item.qty), 0);
    };

    const handleCheckout = async () => {
        if (checkoutInFlightRef.current) {
            return;
        }

        if (cart.length === 0) return;

        // Calculate totals (Tax removed)
        const total = calculateTotal();
        let cash = parseFloat(cashAmount);

        if (isNaN(cash) || cash < total) {
            showErrorDetails("Insufficient cash amount!");
            return;
        }

        checkoutInFlightRef.current = true;
        setIsCheckoutProcessing(true);

        const cartSnapshot = [...cart];

        const transactionData = {
            id: `TRX-${Date.now().toString().slice(-6)}`,
            date: new Date().toLocaleString(),
            items: [...cartSnapshot],
            total,
            cash: cash,
            change: cash - total,
            paymentMethod: 'Cash',
            cashier: currentUserName 
        };

        const authToken = getAuthToken();
        const isOnline = Boolean(authToken) && navigator.onLine && cartSnapshot.every(item => item.id);

        try {
            if (isOnline) {
                try {
                    const apiItems = cartSnapshot.map(item => ({
                        productId: item.id,
                        quantity: item.qty,
                    }));

                    const savedSale = await createSaleApi(apiItems, 'cash', transactionData.id);
                    
                    // If we get here, sync was successful
                    const remoteProducts = await listProductsApi();
                    if (Array.isArray(remoteProducts) && remoteProducts.length > 0) {
                        setInventory(remoteProducts);
                    }

                    const remoteTransaction = {
                        id: savedSale?._id ? `TRX-${savedSale._id.slice(-6).toUpperCase()}` : transactionData.id,
                        date: savedSale?.createdAt ? new Date(savedSale.createdAt).toLocaleString() : transactionData.date,
                        items: [...cartSnapshot],
                        total: savedSale?.totalAmount ?? total,
                        cash,
                        change: cash - total,
                        paymentMethod: 'Cash',
                        cashier: currentUserName,
                    };

                    setTransactions(prev => [remoteTransaction, ...prev]);
                    cartSnapshot.forEach(item => {
                        logAction('DEDUCT', item.code, `Sold ${item.qty} Qty (TRX: ${remoteTransaction.id})`, currentUserName);
                    });

                    setCart([]);
                    setCashAmount('');
                    setLastTransaction(remoteTransaction);
                    setShowReceipt(true);
                    logActivity(currentUserName, 'Processed Sale', `Transaction ${remoteTransaction.id} — ₱${Number(remoteTransaction.total).toLocaleString()}`);
                    showToast("Transaction Complete", "Sale recorded successfully.", "success", "pos-checkout");
                    return;
                } catch (error) {
                    console.warn("Online sync failed, falling back to offline mode:", error);
                }
            }

            // Queue for Sync (Offline Mode)
            // Ensure items have IDs for backend sync later
            addToSyncQueue({ ...transactionData, items: cartSnapshot.map(i => ({ ...i, id: i.id || i._id })) });

            if (isOnline) {
                showToast("Offline Mode", "Transaction saved locally and will sync when online.", "info", "pos-offline-sync");
            }

            // Offline / Fallback Handling
            // Deduct stock from inventory
            const newInventory = inventory.map(item => {
                const cartItem = cartSnapshot.find(c => c.code === item.code);
                if (cartItem) {
                    const newStock = item.stock - cartItem.qty;
                    const statusCarrier = { ...item, stock: newStock };
                    const newStatus = getStockStatus(statusCarrier, settings);
                    
                    return { ...item, stock: newStock, status: newStatus };
                }
                return item;
            });

            setInventory(newInventory);
            
            // Log Transaction & Deduction
            setTransactions(prev => [transactionData, ...prev]);
            cartSnapshot.forEach(item => {
                logAction('DEDUCT', item.code, `Sold ${item.qty} Qty (TRX: ${transactionData.id})`, currentUserName);
            });

            setCart([]);
            setCashAmount('');
            setLastTransaction(transactionData);
            setShowReceipt(true);
            logActivity(currentUserName, 'Processed Sale', `Transaction ${transactionData.id} — ₱${total.toLocaleString()}`);
            showToast("Transaction Complete", "Sale recorded successfully.", "success", "pos-checkout");
        } finally {
            checkoutInFlightRef.current = false;
            setIsCheckoutProcessing(false);
        }
    };

    const [printStatus, setPrintStatus] = useState('idle'); // idle, printing, success

    const handleGenerateQuotation = () => {
        if (!quotationCustomerName.trim()) {
            showErrorDetails("Please enter customer name");
            return;
        }
        
        const quoteData = {
            customerName: quotationCustomerName,
            date: new Date().toLocaleString(),
            items: [...cart],
            total: calculateTotal()
        };

        setQuotationData(quoteData);
        setShowQuotationInput(false);
        setShowQuotationPreview(true);
    };

    const handlePrintQuotationDoc = () => {
        setPrintStatus('printing');
        
        setTimeout(() => {
            const printContent = document.getElementById('quotation-content').innerHTML;
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            
            const printStyle = `
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap');
                    @media print {
                        @page { margin: 0; size: auto; }
                        body { 
                            margin: 0; 
                            padding: 10px; 
                            font-family: 'Courier Prime', 'Courier New', monospace; 
                            color: black;
                            background: white;
                            width: 100%;
                            max-width: 80mm;
                        }
                        * {
                            -webkit-print-color-adjust: exact !important;
                            print-color-adjust: exact !important;
                        }
                        .p-8 { padding: 0 !important; }
                        .mb-6 { margin-bottom: 10px !important; }
                        .mb-4 { margin-bottom: 8px !important; }
                        .text-gray-500, .text-gray-400 { color: black !important; }
                        .text-gray-900, .text-gray-800 { color: black !important; }
                        .bg-gray-50 { background: none !important; }
                        button, .no-print { display: none !important; }
                        h1 { font-size: 18pt !important; font-weight: bold; }
                        h3 { font-size: 12pt !important; }
                        .text-2xl { font-size: 16pt !important; }
                        .text-xl { font-size: 14pt !important; }
                        .text-lg { font-size: 12pt !important; }
                        .text-sm { font-size: 10pt !important; }
                        .text-xs { font-size: 9pt !important; }
                        .border-t, .border-b { border-color: black !important; border-style: dashed !important; }
                    }
                </style>
            `;

            iframe.contentDocument.write('<html><head>' + printStyle + '</head><body><div style="max-width: 80mm; margin: 0 auto;">' + printContent + '</div></body></html>');
            iframe.contentDocument.close();
            
            iframe.contentWindow.focus();
            
            setTimeout(() => {
                iframe.contentWindow.print();
            }, 500);

            const cleanup = () => {
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }
                setPrintStatus('success');
                showToast("Print Success", "Quotation printed successfully.", "success", "pos-print");
                
                setTimeout(() => {
                    setShowQuotationPreview(false);
                    setPrintStatus('idle');
                    setQuotationCustomerName('');
                }, 1500);
            };

            if (iframe.contentWindow.matchMedia) {
                const mediaQueryList = iframe.contentWindow.matchMedia('print');
                mediaQueryList.addEventListener('change', (mql) => {
                    if (!mql.matches) {
                        cleanup();
                    }
                });
            }
            setTimeout(cleanup, 1000); 
        }, 50);
    };

    const handlePrint = () => {
        setPrintStatus('printing');
        
        // Timeout to ensure state updates before blocking print dialog
        setTimeout(() => {
            const printContent = document.getElementById('receipt-content').innerHTML;
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            
            // Print-optimized styles for thermal printers (80mm/58mm)
            const printStyle = `
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap');
                    @media print {
                        @page { margin: 0; size: auto; }
                        body { 
                            margin: 0; 
                            padding: 10px; 
                            font-family: 'Courier Prime', 'Courier New', monospace; 
                            color: black;
                            background: white;
                            width: 100%;
                            max-width: 80mm; /* Standard receipt width */
                        }
                        * {
                            -webkit-print-color-adjust: exact !important;
                            print-color-adjust: exact !important;
                        }
                        /* Override Tailwind utility padding/margins for print */
                        .p-8 { padding: 0 !important; }
                        .mb-6 { margin-bottom: 10px !important; }
                        .mb-4 { margin-bottom: 8px !important; }
                        .text-gray-500, .text-gray-400 { color: black !important; }
                        .text-gray-900, .text-gray-800 { color: black !important; }
                        .bg-gray-50 { background: none !important; }
                        button, .no-print { display: none !important; }
                        
                        /* Typography scaling for thermal paper */
                        h1 { font-size: 10pt !important; font-weight: bold; }
                        h3 { font-size: 9pt !important; }
                        .text-2xl { font-size: 10pt !important; }
                        .text-xl { font-size: 9pt !important; }
                        .text-lg { font-size: 8pt !important; }
                        .text-sm { font-size: 7pt !important; }
                        .text-xs { font-size: 6pt !important; }
                        
                        /* Borders */
                        .border-t, .border-b { border-color: black !important; border-style: dashed !important; }
                    }
                </style>
            `;

            iframe.contentDocument.write('<html><head>' + printStyle + '</head><body><div style="max-width: 80mm; margin: 0 auto;">' + printContent + '</div></body></html>');
            iframe.contentDocument.close();
            
            iframe.contentWindow.focus();
            
            // Give browser a moment to render content before opening print dialog
            setTimeout(() => {
                iframe.contentWindow.print();
            }, 500);

            // Cleanup handled securely
            const cleanup = () => {
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }
                setPrintStatus('success');
                showToast("Print Success", "Receipt printed successfully!", "success", "pos-print-receipt");
                
                // Close modal automatically after a short delay
                setTimeout(() => {
                    setShowReceipt(false);
                    setPrintStatus('idle');
                }, 1500);
            };

            // Try to detect when print dialog closes (browser dependent)
            if (iframe.contentWindow.matchMedia) {
                const mediaQueryList = iframe.contentWindow.matchMedia('print');
                mediaQueryList.addEventListener('change', (mql) => {
                    if (!mql.matches) {
                        cleanup();
                    }
                });
            }
            
            // Fallback cleanup (users might cancel or click print quickly)
            // We set a longer timeout to allow user interaction time
            setTimeout(cleanup, 1000); 
        }, 50);
    };

    // Auto-Print Receipt Effect
    useEffect(() => {
        if (showReceipt && lastTransaction) {
            if (settings?.autoPrintReceipts) {
                // Slight delay to ensure modal DOM is fully rendered
                setTimeout(() => {
                    handlePrint();
                }, 500);
            }
        }
     
    }, [showReceipt, lastTransaction, settings]);

    return (
        <div className="h-[calc(100vh-80px)] flex flex-col gap-2 overflow-y-auto md:overflow-hidden p-2">
            


            <div className="flex flex-col md:flex-row flex-1 gap-2 md:min-h-0">
            {/* Receipt Modal */}
            {showReceipt && lastTransaction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm md:max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="font-bold text-lg text-gray-800">Transaction Receipt</h3>
                            <button onClick={() => setShowReceipt(false)} className="text-gray-400 hover:text-gray-600">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-4 bg-white" id="receipt-content">
                            <div className="text-center mb-4">
                                <p className="Text-2xl font-bold text-gray-900 mb-1">{settings?.storeName || 'Tableria La Confianza'}</p>
                                <div className="text-[10px] text-gray-400 mt-1 space-y-0.5">
                                    <p>{settings?.storeAddress || 'Manila S Rd, Calamba, 4027 Laguna'}</p>
                                    <p>Contact: {settings?.contactPhone || '0917-545-2166'}</p>
                                </div>
                            </div>
                            
                            <div className="border-t border-dashed border-gray-200 py-2 mb-2 text-xs">
                                <div className="flex justify-between mb-0.5">
                                    <span className="text-gray-500">Transaction ID:</span>
                                    <span className="font-mono font-bold text-gray-800">{lastTransaction.id}</span>
                                </div>
                                <div className="flex justify-between mb-0.5">
                                    <span className="text-gray-500">Date:</span>
                                    <span className="text-gray-800">{lastTransaction.date}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Cashier:</span>
                                    <span className="text-gray-800">{lastTransaction.cashier}</span>
                                </div>
                            </div>

                            <table className="w-full text-xs mb-4">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="py-1 text-left font-bold text-gray-700">Item</th>
                                        <th className="py-1 text-center font-bold text-gray-700">Qty</th>
                                        <th className="py-1 text-right font-bold text-gray-700">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-600">
                                    {lastTransaction.items.map((item, i) => (
                                        <tr key={i} className="border-b border-gray-50">
                                            <td className="py-1">
                                                <div className="font-bold text-gray-800">{item.brand ? `${item.brand} ` : ''}{item.name}{item.color ? ` — ${item.color}` : ''}</div>
                                                <div className="text-[10px]">{item.code}</div>
                                            </td>
                                            <td className="py-1 text-center">{item.qty}</td>
                                            <td className="py-1 text-right">₱{(item.price * item.qty).toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="space-y-1 text-right text-xs border-t border-gray-200 pt-2">
                                <div className="flex justify-between text-base font-black text-gray-900 pt-1 border-t border-gray-900 mt-1">
                                    <span>TOTAL</span>
                                    <span>₱{lastTransaction.total.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-gray-600 pt-1 text-[10px] uppercase font-bold">
                                    <span>Cash</span>
                                    <span>₱{(lastTransaction.cash || 0).toFixed(2)}</span>
                                </div>

                                {lastTransaction.paymentMethod === 'Cheque' ? (
                                    <div className="flex justify-between text-gray-500 text-[10px]">
                                        <span>Check No:</span>
                                        <span className="font-mono">{lastTransaction.chequeNo}</span>
                                    </div>
                                ) : (
                                    <div className="flex justify-between text-gray-500 text-[10px]">
                                        <span>Change</span>
                                        <span>₱{(lastTransaction.change || 0).toFixed(2)}</span>
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 text-center text-[10px] text-gray-400">
                                <p>Thank you for choosing Tableria La Confianza Co., Inc.</p>
                                <p>Please retain this receipt for returns and service support.</p>
                            </div>
                        </div>

                        <div className="p-4 bg-gray-50 border-t border-gray-100 grid grid-cols-2 gap-3">
                            <button 
                                onClick={() => setShowReceipt(false)}
                                className="py-2 px-4 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-100 transition-all duration-300 flex items-center justify-center gap-2 shadow-sm transform hover:-translate-y-0.5 text-gray-600 bg-white"
                                style={{ border: '2px solid #e5e7eb' }}
                            >
                                Close
                            </button>
                            <button 
                                onClick={handlePrint}
                                disabled={printStatus === 'printing'}
                                className={`py-2 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 shadow-sm transform ${printStatus === 'printing' ? 'opacity-80 cursor-wait' : 'hover:opacity-90 hover:-translate-y-0.5'}`}
                                style={{ backgroundColor: printStatus === 'success' ? '#10B981' : '#111827', color: '#ffffff', border: printStatus === 'success' ? '2px solid #10B981' : '2px solid #111827' }}
                            >
                                {printStatus === 'printing' ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Printing...
                                    </>
                                ) : printStatus === 'success' ? (
                                    <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                        Printed
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2-4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                                        Print
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Left Side: Product Grid */}
            <div className="min-h-[400px] md:min-h-0 flex-1 bg-slate-200/50 rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden border-t-8 border-t-[#111827]">
                {/* Header */}
                <div className="p-5 pb-0 flex items-center gap-2 shrink-0">
                    <div className="hidden sm:block">
                        <svg className="w-7 h-7 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-gray-900 leading-tight">Point of Sale</h1>
                        <p className="text-gray-500 text-xs mt-1">Process transactions and manage orders</p>
                    </div>
                </div>
                
                {/* Search and Filter Header */}
                <div className="px-5 pb-5 pt-5 border-b border-gray-200 bg-transparent z-10 shrink-0">
                    <div className="flex flex-col md:flex-row gap-4 mb-0">
                        <div className="relative w-full md:max-w-xs group">
                            <input
                                type="text"
                                placeholder="Search products..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-3 py-2 bg-gray-50 border-2 border-gray-100 rounded-xl text-sm focus:bg-white focus:border-gray-900 focus:ring-4 focus:ring-gray-100 transition-all shadow-sm placeholder:text-gray-400 font-bold text-gray-800"
                            />
                             <div className="absolute left-3 top-1/2 -translate-y-1/2 p-1 bg-white rounded-lg shadow-sm border border-gray-100 group-focus-within:border-gray-900 group-focus-within:bg-gray-900 transition-all duration-300">
                                <svg className="w-3.5 h-3.5 text-gray-400 group-focus-within:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                        </div>
                        <select
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="appearance-none w-full md:w-48 px-3 py-1.5 rounded-xl text-sm font-bold inline-flex items-center transition-all border-2 bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500 hover:opacity-90"
                        >
                            {categories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Product List */}
                <div className="flex-1 overflow-y-auto p-4 bg-transparent">
                    {filteredProducts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full">
                            <div className="flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-300 rounded-xl p-8 bg-transparent">
                                <div className="bg-white p-4 rounded-full mb-4 shadow-sm ring-1 ring-gray-200">
                                    <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293H9.414a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 005.586 13H4"></path>
                                    </svg>
                                </div>
                                <h3 className="text-lg font-bold text-gray-900 mb-1">No products found</h3>
                                <p className="text-gray-500 text-sm max-w-xs mx-auto text-center">
                                    {searchQuery 
                                        ? `We couldn't find any items matching "${searchQuery}".`
                                        : 'Select a category to view products.'
                                    }
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 pb-4">
                                {currentItems.map(item => (
                                    (() => {
                                        if (item.isGroup) {
                                            const isOutOfStock = item.stock <= 0;
                                            const isLowStock = item.variants.some(v => getStockStatus(v, settings) === 'Low Stock');

                                            return (
                                                <div
                                                    key={item.code}
                                                    onClick={() => setVariantModal({ isOpen: true, group: item, step: item.availableBrands?.length > 1 ? 'brand' : 'variants', selectedBrand: null, selectedSize: null, selectedColor: null })}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            setVariantModal({ isOpen: true, group: item, step: item.availableBrands?.length > 1 ? 'brand' : 'variants', selectedBrand: null, selectedSize: null, selectedColor: null });
                                                        }
                                                    }}
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`relative flex flex-col rounded-2xl border transition-all duration-300 text-left group overflow-hidden bg-white
                                                        min-h-[220px]
                                                        ${isOutOfStock 
                                                            ? 'border-red-100 shadow-sm opacity-80' 
                                                            : 'border-slate-100 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:border-indigo-100 hover:-translate-y-1'
                                                        }`}
                                                >
                                                    <div className={`h-1 w-full absolute top-0 left-0 transition-opacity duration-300 ${isOutOfStock ? 'bg-red-300' : 'bg-gradient-to-r from-indigo-500 to-purple-500 opacity-0 group-hover:opacity-100'}`}></div>
            
                                                    <div className="p-4 flex flex-col flex-1 mt-1">
                                                        <h3 className="font-extrabold text-slate-800 text-[15px] leading-snug line-clamp-2 min-h-[44px] mb-2 group-hover:text-indigo-600 transition-colors">
                                                            {item.name}
                                                        </h3>
            
                                                        <div className="flex items-center gap-1.5 mb-3 overflow-hidden min-h-[22px]">
                                                            {item.brand && (
                                                                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md truncate max-w-[86px]">{item.brand}</span>
                                                            )}
                                                            {item.color && (
                                                                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md truncate max-w-[64px]">{item.color}</span>
                                                            )}
                                                            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50/80 px-2 py-0.5 rounded-md border border-indigo-100 truncate shadow-sm">{item.variants.length} Options</span>
                                                        </div>
            
                                                        <div className="flex items-center justify-between mb-3 gap-2 min-h-[20px]">
                                                            <span className="text-[10px] font-mono font-medium text-slate-400 truncate shrink-0">Product Group</span>
                                                            {isOutOfStock ? (
                                                                <span className="text-[10px] font-bold text-red-600 bg-red-50/80 px-2 py-0.5 rounded-md border border-red-100 shrink-0">Out of Stock</span>
                                                            ) : (
                                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${isLowStock ? 'text-amber-700 bg-amber-50/80 border-amber-100' : 'text-emerald-700 bg-emerald-50/80 border-emerald-100'}`}>
                                                                    {item.stock} in stock
                                                                </span>
                                                            )}
                                                        </div>
            
                                                        <div className="mt-auto pt-3 border-t border-slate-100 space-y-2">
                                                            <div className="flex items-center justify-between gap-2 min-h-[28px]">
                                                                <span className="font-black text-slate-900 text-sm leading-none truncate tracking-tight">
                                                                    {item.minPrice === item.maxPrice ? formatCurrency(item.minPrice) : `${formatCurrency(item.minPrice)} - ${formatCurrency(item.maxPrice)}`}
                                                                </span>
                                                                <div className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 shadow-md shrink-0">
                                                                    <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                                                                </div>
                                                            </div>
                                                            <div className="min-h-[26px]">
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setVariantModal({ isOpen: true, group: item, step: item.availableBrands?.length > 1 ? 'brand' : 'variants', selectedBrand: null, selectedSize: null, selectedColor: null });
                                                                    }}
                                                                    className="h-7 w-full rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-indigo-100 hover:border-indigo-300 flex items-center justify-center gap-1 shadow-sm"
                                                                >
                                                                    Select Options
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        const status = getStockStatus(item, settings);
                                        const isOutOfStock = status === 'Out of Stock';
                                        const isLowStock = status === 'Low Stock';
                                        const hasAlternatives = getAlternatives(item, inventory, settings, { maxSuggestions: 1 }).length > 0;

                                        return (
                                    <div
                                        key={item.code}
                                        onClick={() => addToCart(item)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                addToCart(item);
                                            }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                        className={`relative flex flex-col rounded-2xl border transition-all duration-300 text-left group overflow-hidden bg-white
                                            min-h-[220px]
                                            ${isOutOfStock 
                                                ? 'border-red-100 shadow-sm opacity-80' 
                                                : 'border-slate-100 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:border-slate-300 hover:-translate-y-1'
                                            }`}
                                    >
                                        {/* Top accent */}
                                        <div className={`h-1 w-full absolute top-0 left-0 transition-opacity duration-300 ${isOutOfStock ? 'bg-red-300' : 'bg-slate-800 opacity-0 group-hover:opacity-100'}`}></div>

                                        <div className="p-4 flex flex-col flex-1 mt-1">
                                            {/* Row 1: Name (main focus) */}
                                            <h3 className="font-extrabold text-slate-800 text-[15px] leading-snug line-clamp-2 min-h-[44px] mb-2 group-hover:text-black transition-colors">
                                                {item.name}
                                            </h3>

                                            {/* Row 2: Brand & Color/Variant tags */}
                                            <div className="flex items-center gap-1.5 mb-3 overflow-hidden min-h-[22px]">
                                                {item.brand && (
                                                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md truncate max-w-[86px]">{item.brand}</span>
                                                )}
                                                {item.color && (
                                                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md truncate max-w-[64px]">{item.color}</span>
                                                )}
                                                {item.size && (
                                                    <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200 truncate max-w-[102px]">{item.size}</span>
                                                )}
                                            </div>

                                            {/* Row 3: Code + Stock (small info row) */}
                                            <div className="flex items-center justify-between mb-3 gap-2 min-h-[20px]">
                                                <span className="text-[10px] font-mono font-medium text-slate-400 truncate">{item.code}</span>
                                                {isOutOfStock ? (
                                                    <span className="text-[10px] font-bold text-red-600 bg-red-50/80 px-2 py-0.5 rounded-md border border-red-100 shrink-0">Out of Stock</span>
                                                ) : (
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${isLowStock ? 'text-amber-700 bg-amber-50/80 border-amber-100' : 'text-emerald-700 bg-emerald-50/80 border-emerald-100'}`}>
                                                        {item.stock} in stock
                                                    </span>
                                                )}
                                            </div>

                                            {/* Row 4: Price + actions */}
                                            <div className="mt-auto pt-3 border-t border-slate-100 space-y-2">
                                                <div className="flex items-center justify-between gap-2 min-h-[28px]">
                                                    <span className="font-black text-slate-900 text-[17px] leading-none truncate tracking-tight">{formatCurrency(item.price)}</span>
                                                    <div className="h-8 w-8 rounded-full bg-slate-800 text-white flex items-center justify-center opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 shadow-md shrink-0">
                                                        <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                                                    </div>
                                                </div>
                                                <div className="min-h-[26px]">
                                                    {hasAlternatives && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openBudgetAlternatives(item);
                                                            }}
                                                            className="h-7 w-full rounded-lg border border-emerald-200 bg-emerald-50/80 text-emerald-700 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-emerald-100 hover:border-emerald-300 shadow-sm"
                                                        >
                                                            Product Options
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                        );
                                    })()
                                ))}
                            </div>

                            {/* Pagination Controls */}
                            <div className="shrink-0 flex justify-between items-center pt-3 border-t border-gray-100 mt-auto">
                                    <div className="text-xs text-gray-500 font-medium">
                                        Showing <span className="font-bold text-gray-900">{filteredProducts.length === 0 ? 0 : indexOfFirstItem + 1}</span> to <span className="font-bold text-gray-900">{Math.min(indexOfLastItem, filteredProducts.length)}</span> of <span className="font-bold text-gray-900">{filteredProducts.length}</span> results
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                            disabled={currentPage === 1}
                                            className={`p-1.5 rounded-lg border border-gray-200 transition-all ${currentPage === 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-50 hover:border-gray-300'}`}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                                        </button>
                                        {(() => {
                                            const maxVisible = 5;
                                            let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                                            let end = start + maxVisible - 1;
                                            if (end > totalPages) { end = totalPages; start = Math.max(1, end - maxVisible + 1); }
                                            const pages = [];
                                            if (start > 1) pages.push(<button key="first" onClick={() => setCurrentPage(1)} className="w-7 h-7 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-100 transition-all">1</button>);
                                            if (start > 2) pages.push(<span key="dots-start" className="text-gray-400 text-xs px-0.5">...</span>);
                                            for (let i = start; i <= end; i++) {
                                                pages.push(
                                                    <button key={i} onClick={() => setCurrentPage(i)}
                                                        className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                                                            currentPage === i
                                                            ? 'bg-gray-900 text-white shadow-sm'
                                                            : 'text-gray-600 hover:bg-gray-100'
                                                        }`}
                                                    >{i}</button>
                                                );
                                            }
                                            if (end < totalPages - 1) pages.push(<span key="dots-end" className="text-gray-400 text-xs px-0.5">...</span>);
                                            if (end < totalPages) pages.push(<button key="last" onClick={() => setCurrentPage(totalPages)} className="w-7 h-7 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-100 transition-all">{totalPages}</button>);
                                            return pages;
                                        })()}
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                            disabled={currentPage === totalPages}
                                            className={`p-1.5 rounded-lg border border-gray-200 transition-all ${currentPage === totalPages ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-50 hover:border-gray-300'}`}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                                        </button>
                                    </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Right Side: Cart / Order Summary */}
            <div className="w-full md:w-80 bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300 border-t-8 border-t-[#111827] flex flex-col min-h-[300px] md:h-full z-20">
                <div className="p-3 border-b border-slate-300 flex justify-between items-center bg-slate-200/50 rounded-t-2xl shrink-0">
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                        <h3 className="font-semibold text-lg text-gray-900">Current Order</h3>
                    </div>
                    <span className="bg-slate-300 text-gray-900 text-xs font-bold px-2 py-0.5 rounded-full">{cart.reduce((acc, item) => acc + item.qty, 0)} items</span>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {cart.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
                            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                                <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                            </div>
                            <p className="text-sm font-medium">Cart is empty</p>
                        </div>
                    ) : (
                        cart.map(item => (
                            <div key={item.code} className="bg-white border border-gray-100 p-2 rounded-lg shadow-sm hover:border-gray-300 transition-colors group">
                                <div className="flex justify-between mb-1">
                                    <h4 className="font-bold text-gray-800 text-sm line-clamp-1">
                                        {item.brand && <span className="text-gray-400 font-medium">{item.brand} </span>}
                                        {item.name}
                                        {item.color && <span className="text-gray-400 font-normal text-xs"> — {item.color}</span>}
                                    </h4>
                                    <button onClick={() => removeFromCart(item.code)} className="text-gray-400 hover:text-rose-500">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                    </button>
                                </div>
                                <div className="flex justify-between items-center mt-1">
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => updateQuantity(item.code, item.qty - 1)}
                                            className="w-6 h-6 rounded flex items-center justify-center hover:opacity-90 shadow-md transform hover:-translate-y-0.5 transition-all text-sm font-bold pb-0.5"
                                            style={{ backgroundColor: '#111827', color: '#ffffff' }}
                                        >
                                            -
                                        </button>
                                        <input
                                            type="number"
                                            min="1"
                                            onFocus={(e) => e.target.select()}
                                            value={item.qty}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val) && val > 0) {
                                                    updateQuantity(item.code, val);
                                                }
                                            }}
                                            className="w-12 text-center text-sm font-black bg-white border border-gray-300 rounded focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none"
                                        />
                                        <button 
                                            onClick={() => updateQuantity(item.code, item.qty + 1)}
                                            className="w-6 h-6 rounded flex items-center justify-center hover:opacity-90 shadow-md transform hover:-translate-y-0.5 transition-all text-sm font-bold pb-0.5"
                                            style={{ backgroundColor: '#111827', color: '#ffffff' }}
                                        >
                                            +
                                        </button>
                                    </div>
                                    <span className="font-black text-base text-gray-900">₱{(item.price * item.qty).toFixed(2)}</span>
                                </div>
                                <div className="mt-1 text-[10px] text-gray-500 flex justify-between">
                                    <span>{item.code}</span>
                                    <span>@ {formatCurrency(item.price)}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-3 bg-slate-200/50 border-t border-slate-300 rounded-b-2xl shrink-0 z-30">
                    <div className="space-y-2 mb-3 bg-white p-2 rounded-lg">
                        {/* Cash & Change Inputs */}
                         <div className="flex justify-between items-center text-sm text-gray-600 font-bold">
                            <span>Cash</span>
                            <div className="relative group">
                            <div className={`flex items-center gap-1 border-b border-gray-300 transition-colors ${cart.length > 0 ? 'focus-within:border-gray-900' : ''}`}>
                                <span>₱</span>
                                <input 
                                    type="number" 
                                    disabled={cart.length === 0}
                                    value={cashAmount}
                                    onChange={(e) => setCashAmount(e.target.value)}
                                    onBlur={() => {
                                        const val = parseFloat(cashAmount);
                                        if (!isNaN(val)) {
                                            setCashAmount(val.toFixed(2));
                                        }
                                    }}
                                    placeholder="0.00"
                                    className={`w-20 text-right bg-transparent outline-none font-bold text-sm text-gray-900 ${cart.length === 0 ? 'cursor-not-allowed' : ''}`}
                                />
                            </div>
                            {cart.length === 0 && (
                                <div className="pointer-events-none absolute -top-11 right-0 z-30 hidden w-max max-w-[260px] group-hover:block group-focus-within:block">
                                    <div className="rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-semibold text-white shadow-xl ring-1 ring-black/10">
                                        Add item first
                                    </div>
                                    <span className="absolute -bottom-1 right-4 h-2 w-2 rotate-45 bg-gray-900" />
                                </div>
                            )}
                            </div>
                        </div>
                        <div className="flex justify-between items-center text-sm text-gray-600 font-bold">
                            <span>Change</span>
                            <span className="text-gray-900 font-bold">
                                ₱ {Math.max(0, (parseFloat(cashAmount) || 0) - calculateTotal()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>

                        <div className="flex justify-between font-bold text-xl text-gray-900 pt-2 border-t border-dashed border-gray-200">
                            <span>Total</span>
                            <span>₱ {calculateTotal().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <div className={`relative group flex-1 ${cart.length === 0 ? 'cursor-not-allowed' : ''}`}>
                            <button 
                                onClick={() => setShowQuotationInput(true)}
                                disabled={cart.length === 0}
                                style={{ backgroundColor: '#ffffff', color: '#111827', border: '2px solid #111827' }}
                                className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center shadow-md transform transition-transform duration-150 ${cart.length === 0 ? 'pointer-events-none' : 'hover:opacity-90 hover:-translate-y-0.5'}`}
                            >
                                Quotation
                            </button>
                            {cart.length === 0 && (
                                <div className="pointer-events-none absolute -top-11 right-0 z-30 hidden w-max max-w-[260px] group-hover:block group-focus-within:block">
                                    <div className="rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-semibold text-white shadow-xl ring-1 ring-black/10">
                                        Add item first
                                    </div>
                                    <span className="absolute -bottom-1 right-6 h-2 w-2 rotate-45 bg-gray-900" />
                                </div>
                            )}
                        </div>
                        <div className={`relative group flex-1 ${(cart.length === 0 || !cashAmount || isCheckoutProcessing) ? 'cursor-not-allowed' : ''}`}>
                            <button 
                                onClick={handleCheckout}
                                disabled={cart.length === 0 || !cashAmount || isCheckoutProcessing}
                                style={{ backgroundColor: '#111827', color: '#ffffff', border: '2px solid #111827' }}
                                className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center shadow-xl transform transition-transform duration-150 ${(cart.length === 0 || !cashAmount || isCheckoutProcessing) ? 'pointer-events-none' : 'hover:opacity-90 hover:-translate-y-0.5'}`}
                            >
                                {isCheckoutProcessing ? 'Processing...' : 'Process Payment'}
                            </button>
                            {(cart.length === 0 || !cashAmount || isCheckoutProcessing) && (
                                <div className="pointer-events-none absolute -top-11 right-0 z-30 hidden w-max max-w-[260px] group-hover:block group-focus-within:block">
                                    <div className="rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-semibold text-white shadow-xl ring-1 ring-black/10">
                                        {cart.length === 0 ? 'Add item first' : isCheckoutProcessing ? 'Processing payment...' : 'Enter cash first'}
                                    </div>
                                    <span className="absolute -bottom-1 right-6 h-2 w-2 rotate-45 bg-gray-900" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        {/* Recommendation Modal */}
        {recommendationModal.isOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                    <div className={`p-3 border-b ${recommendationModal.type === 'out-of-stock' ? 'bg-red-50 border-red-100' : recommendationModal.type === 'low-stock' ? 'bg-yellow-50 border-yellow-100' : 'bg-emerald-50 border-emerald-100'}`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`p-1.5 rounded-lg ${recommendationModal.type === 'out-of-stock' ? 'bg-red-100 text-red-600' : recommendationModal.type === 'low-stock' ? 'bg-yellow-100 text-yellow-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className={`text-base font-black tracking-tight ${recommendationModal.type === 'out-of-stock' ? 'text-red-900' : recommendationModal.type === 'low-stock' ? 'text-yellow-900' : 'text-emerald-900'}`}>
                                        {recommendationModal.type === 'out-of-stock'
                                            ? 'Item Out of Stock'
                                            : recommendationModal.type === 'low-stock'
                                                ? 'Low Stock Warning'
                                                : 'Budget Alternatives'}
                                    </h3>
                                    <p className={`text-xs font-medium mt-0 ${recommendationModal.type === 'out-of-stock' ? 'text-red-700' : recommendationModal.type === 'low-stock' ? 'text-yellow-700' : 'text-emerald-700'}`}>
                                        {recommendationModal.item.brand ? `${recommendationModal.item.brand} ` : ''}{recommendationModal.item.name}{recommendationModal.item.color ? ` — ${recommendationModal.item.color}` : ''} ({recommendationModal.item.code})
                                    </p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setRecommendationModal({ isOpen: false, item: null, alternatives: [] })}
                                className="text-gray-400 hover:text-gray-600 p-1 hover:bg-white rounded-full transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    </div>

                    <div className="p-4">
                        <h4 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            {recommendationModal.type === 'in-stock' ? 'Budget Alternatives' : 'Recommended Alternatives'}
                        </h4>

                        <p className="text-[11px] text-gray-500 mb-3">
                            {recommendationModal.type === 'in-stock'
                                ? 'Value/Standard/Premium is based on price relative to the selected product.'
                                : 'Low/Out-of-stock items use standard alternatives.'}
                        </p>
                        
                        {recommendationModal.alternatives.length > 0 ? (
                            <div className="max-h-[440px] overflow-y-auto pr-2 -mr-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pb-2">
                                    {recommendationModal.alternatives.map(alt => (
                                        <div 
                                            key={alt.code} 
                                            className="group p-5 rounded-2xl border border-slate-200 hover:border-slate-800 hover:shadow-xl transition-all duration-300 cursor-pointer relative bg-white flex flex-col h-[210px] overflow-hidden shrink-0 hover:-translate-y-1"
                                        onClick={() => {
                                            addToCart(alt, true, { silentNotification: true });
                                            setRecommendationModal({ isOpen: false, item: null, alternatives: [] });
                                            showToast(
                                                'Selected Alternative',
                                                `${alt.brand ? alt.brand + ' ' : ''}${alt.name}${alt.color ? ` — ${alt.color}` : ''}`,
                                                'success',
                                                'pos-selected-alternative'
                                            );
                                        }}
                                    >
                                        {/* Decorative Top Line */}
                                        <div className="absolute top-0 left-0 right-0 h-1 bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                                        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                            <span className="text-white text-[10px] font-extrabold px-3 py-1 rounded-full shadow-md transform scale-105 bg-slate-900 tracking-wider">SELECT</span>
                                        </div>
                                        
                                        <div className="mb-3 mt-1 min-h-[64px]">
                                            <h5 className="text-[15px] font-extrabold text-slate-800 group-hover:text-black leading-snug mb-2 line-clamp-2 min-h-[44px] pr-8">
                                                {alt.brand && <span className="text-slate-400 font-bold">{alt.brand} </span>}
                                                {alt.name}
                                                {alt.color && <span className="text-slate-500 font-medium"> — {alt.color}</span>}
                                            </h5>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-[11px] font-semibold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md inline-block font-mono">{alt.code}</p>
                                            {recommendationModal.type === 'in-stock' && (
                                                <span className={`text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-md inline-block ${(getRelativeTierKey(alt.price, recommendationModal.item?.price) === 'low') ? 'bg-emerald-50/80 text-emerald-700 border border-emerald-200/80' : (getRelativeTierKey(alt.price, recommendationModal.item?.price) === 'moderate') ? 'bg-amber-50/80 text-amber-700 border border-amber-200/80' : 'bg-rose-50/80 text-rose-700 border border-rose-200/80'}`}>
                                                    {getTierDisplayLabel(getRelativeTierKey(alt.price, recommendationModal.item?.price))}
                                                </span>
                                            )}
                                            </div>
                                        </div>
                                        
                                        <div className="mt-auto space-y-3">
                                            <div className="grid grid-cols-[48px_1fr] items-start border-b border-slate-100 pb-2 gap-2">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Size</span>
                                                <span className="text-[13px] font-extrabold text-slate-800 leading-tight text-right break-words min-h-[18px]">{alt.size || '-'}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 items-end">
                                                <div className="min-w-0">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Price</p>
                                                    <p className="text-lg font-black text-slate-900 truncate tracking-tight">{formatCurrency(alt.price)}</p>
                                                </div>
                                                <div className="text-right min-w-0">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Stock</p>
                                                    <p className={`text-[15px] font-black truncate shadow-sm rounded-md px-2 py-0.5 inline-block border ${alt.stock < 20 ? 'text-amber-700 bg-amber-50/80 border-amber-100' : 'text-emerald-700 bg-emerald-50/80 border-emerald-100'}`}>{alt.stock}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        ) : (
                            <div className="p-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
                                <svg className="w-12 h-12 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <h3 className="text-sm font-bold text-gray-900">No alternatives found</h3>
                                <p className="text-gray-500 italic mt-0.5 text-xs">We couldn't find similar items in stock for this product.</p>
                            </div>
                        )}
                    </div>

                    <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                        <button 
                            onClick={() => setRecommendationModal({ isOpen: false, item: null, alternatives: [] })}
                            className="px-4 py-2 rounded-xl text-xs font-bold text-black bg-transparent hover:bg-gray-100 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                            style={{ border: '2px solid #000' }}
                        >
                            Cancel
                        </button>
                        {recommendationModal.type === 'low-stock' && (
                            <button 
                                onClick={() => addToCart(recommendationModal.item, true)}
                                className="px-5 py-2 rounded-xl text-xs font-bold text-white hover:opacity-90 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                                style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                            >
                                Continue with Original ({recommendationModal.item.stock} left)
                            </button>
                        )}
                    </div>
                </div>
            </div>
        )}
        {/* Variant Picker Modal */}
        {variantModal.isOpen && variantModal.group && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md transition-all">
                <div className="bg-white w-full max-w-xl rounded-[2rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.2)] flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-300 overflow-hidden ring-1 ring-slate-900/5">
                    <div className="px-6 py-5 border-b border-slate-100 bg-white/70 backdrop-blur-xl flex flex-col gap-4 relative z-10">
                        <div className="w-full">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                {variantModal.step === 'variants' && variantModal.group.availableBrands?.length > 1 && (
                                    <button 
                                        onClick={() => setVariantModal(prev => ({ ...prev, step: 'brand', selectedBrand: null, selectedSize: null, selectedColor: null }))}
                                        className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1 transition-all"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                                        Back to Brands
                                    </button>
                                )}
                                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-full uppercase tracking-widest">{variantModal.step === 'brand' ? 'Select Brand' : 'Product Group'}</span>
                                {variantModal.step === 'variants' && variantModal.selectedBrand && <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">{variantModal.selectedBrand}</span>}
                                {variantModal.step === 'variants' && !variantModal.selectedBrand && variantModal.group.brand && variantModal.group.brand !== 'Multiple Brands' && <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">{variantModal.group.brand}</span>}
                            </div>
                            <h3 className="text-2xl font-black text-slate-900 tracking-tight leading-tight text-center">
                                {variantModal.group.name}
                            </h3>
                            {variantModal.group.color && variantModal.group.color !== 'Multiple Colors' && <p className="text-sm font-medium text-slate-500 mt-1 text-center">Base Color: <span className="text-slate-800 font-semibold">{variantModal.group.color}</span></p>}
                        </div>
                        <button 
                            onClick={() => setVariantModal({ isOpen: false, group: null, step: 'brand', selectedBrand: null, selectedSize: null, selectedColor: null })}
                            className="absolute top-5 right-6 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-2 rounded-full transition-all"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto w-full max-h-full no-scrollbar">
                        {variantModal.step === 'brand' ? (
                            <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-3 pb-12">
                                {variantModal.group.availableBrands.map(brand => {
                                    const brandVariants = variantModal.group.variants.filter(v => v.brand === brand);
                                    const isBrandOutOfStock = brandVariants.every(v => v.stock <= 0);
                                    const brandPrices = brandVariants.map(v => Number(v.price) || 0);
                                    const minBrandPrice = brandPrices.length ? Math.min(...brandPrices) : 0;
                                    const maxBrandPrice = brandPrices.length ? Math.max(...brandPrices) : 0;
                                    const brandPriceLabel = minBrandPrice === maxBrandPrice
                                        ? formatCurrency(minBrandPrice)
                                        : `${formatCurrency(minBrandPrice)} - ${formatCurrency(maxBrandPrice)}`;
                                    
                                    return (
                                        <div 
                                            key={brand || 'unbranded'}
                                            className={`group p-4 rounded-2xl border-2 transition-all duration-300 relative flex flex-col items-center justify-center text-center min-h-[128px] 
                                                ${isBrandOutOfStock 
                                                    ? 'bg-rose-50/30 border-rose-100 cursor-not-allowed opacity-70 grayscale-[0.5]' 
                                                    : 'bg-white border-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_4px_10px_rgba(0,0,0,0.03)] hover:border-indigo-500/20 hover:shadow-[0_0_0_2px_rgba(99,102,241,0.2),0_10px_25px_-5px_rgba(0,0,0,0.1)] cursor-pointer hover:-translate-y-1'
                                                }`}
                                            onClick={() => {
                                                if (!isBrandOutOfStock) {
                                                    setVariantModal(prev => ({ ...prev, step: 'variants', selectedBrand: brand }));
                                                }
                                            }}
                                        >
                                            <div className={`w-11 h-11 mb-3 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 duration-300 ${isBrandOutOfStock ? 'bg-rose-100 text-rose-400' : 'bg-gradient-to-br from-indigo-50 to-blue-50 text-indigo-500 shadow-inner'}`}>
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                                            </div>
                                            <h4 className="text-base font-black text-slate-800 tracking-tight leading-tight">{brand || 'Unbranded'}</h4>
                                            
                                            <div className="flex-1 flex flex-col justify-end mt-2 w-full">
                                                <div className={`text-[11px] font-bold py-1 px-2.5 rounded-lg inline-block mx-auto transition-all duration-300 ${isBrandOutOfStock ? 'bg-transparent text-rose-500/0 hidden' : 'bg-slate-50 text-slate-600 border border-slate-100 shadow-sm group-hover:bg-indigo-50 group-hover:text-indigo-700 group-hover:border-indigo-100'}`}>
                                                    {brandPriceLabel}
                                                </div>
                                                {isBrandOutOfStock && (
                                                    <span className="text-[10px] font-bold text-rose-600 bg-rose-100/80 border border-rose-200/50 px-3 py-1 rounded-full uppercase tracking-widest mt-1 shadow-sm">Out of Stock</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col h-full relative">
                                {(() => {
                                    const filteredVariants = variantModal.group.variants.filter(v => variantModal.selectedBrand ? v.brand === variantModal.selectedBrand : true);
                                    const uniqueColors = Array.from(new Set(filteredVariants.map(v => v.color).filter(Boolean))).sort();
                                    const uniqueSizes = Array.from(new Set(filteredVariants.map(v => v.size).filter(Boolean))).sort();

                                    const needsColor = uniqueColors.length > 0;
                                    const needsSize = uniqueSizes.length > 0;
                                    const hasSelectedColor = variantModal.selectedColor !== null;
                                    const hasSelectedSize = variantModal.selectedSize !== null;

                                    const isAllSelected = (!needsColor || hasSelectedColor) && (!needsSize || hasSelectedSize);

                                    const matchedVariant = isAllSelected ? filteredVariants.find(v => 
                                        (!needsColor || v.color === variantModal.selectedColor) && 
                                        (!needsSize || v.size === variantModal.selectedSize)
                                    ) : null;

                                    return (
                                        <div className="flex flex-col bg-white overflow-hidden h-full relative">
                                            <div className="flex-1 overflow-y-auto p-6 pb-24 no-scrollbar">
                                                <div className="flex justify-between items-start mb-6 bg-slate-50 border border-slate-100 rounded-3xl p-5 shadow-sm">
                                                    <div>
                                                        <h4 className="text-3xl font-black text-slate-900 tracking-tight">
                                                            {matchedVariant 
                                                                ? formatCurrency(matchedVariant.price) 
                                                                : (Math.min(...filteredVariants.map(v => v.price)) === Math.max(...filteredVariants.map(v => v.price)) 
                                                                    ? formatCurrency(Math.min(...filteredVariants.map(v => v.price))) 
                                                                    : `${formatCurrency(Math.min(...filteredVariants.map(v => v.price)))} - ${formatCurrency(Math.max(...filteredVariants.map(v => v.price)))}`)}
                                                        </h4>
                                                        <div className="mt-2 flex items-center gap-2">
                                                            {!isAllSelected ? (
                                                                <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md uppercase tracking-widest border border-amber-100">Select options</span>
                                                            ) : !matchedVariant ? (
                                                                <span className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-md uppercase tracking-widest border border-rose-100">Unavailable</span>
                                                            ) : parseInt(matchedVariant.stock) <= 0 ? (
                                                                <span className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-md uppercase tracking-widest border border-rose-100">Out of Stock</span>
                                                            ) : parseInt(matchedVariant.stock) <= 15 ? (
                                                                <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md uppercase tracking-widest border border-amber-100">{matchedVariant.stock} left (Low)</span>
                                                            ) : (
                                                                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md uppercase tracking-widest border border-emerald-100">{matchedVariant.stock} in stock</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {matchedVariant && (
                                                        <div className="text-right">
                                                            <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-1">SKU Code</p>
                                                            <p className="text-xs font-bold text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">{matchedVariant.code}</p>
                                                        </div>
                                                    )}
                                                </div>

                                                {needsSize && (
                                                    <div className="mb-8">
                                                        <div className="flex items-center justify-between mb-3">
                                                            <h5 className="text-[12px] font-black text-slate-800 uppercase tracking-widest">Select Size</h5>
                                                            {hasSelectedSize && <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{variantModal.selectedSize}</span>}
                                                        </div>
                                                        <div className="flex flex-wrap gap-2.5">
                                                            {uniqueSizes.map(size => {
                                                                const isSelected = variantModal.selectedSize === size;
                                                                const hasStock = filteredVariants.some(v => v.size === size && (!needsColor || v.color === variantModal.selectedColor || !hasSelectedColor) && v.stock > 0);

                                                                return (
                                                                    <div key={size} className={`relative group ${!hasStock ? 'cursor-not-allowed' : ''}`}>
                                                                        <button
                                                                            disabled={!hasStock}
                                                                            onClick={() => { if(hasStock) setVariantModal(prev => ({ ...prev, selectedSize: isSelected ? null : size })) }}
                                                                            className={`min-w-[56px] px-4 py-2.5 text-sm font-bold rounded-xl border-2 transition-all duration-200 ${isSelected ? 'border-slate-900 bg-slate-900 text-white shadow-md scale-105' : hasStock ? 'border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 bg-white hover:shadow-sm hover:-translate-y-0.5' : 'border-slate-100 text-slate-400 bg-slate-50 cursor-not-allowed opacity-60 pointer-events-none'}`}
                                                                        >
                                                                            {size}
                                                                        </button>
                                                                        {!hasStock && (
                                                                            <div className="pointer-events-none absolute -top-11 left-1/2 -translate-x-1/2 z-30 hidden w-max group-hover:block transition-all">
                                                                                <div className="rounded-xl bg-slate-900 px-3 py-1.5 text-[10px] font-bold text-white shadow-xl">      
                                                                                    Sold Out
                                                                                </div>
                                                                                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-slate-900" />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {needsColor && (
                                                    <div className="mb-4">
                                                        <div className="flex items-center justify-between mb-3">
                                                            <h5 className="text-[12px] font-black text-slate-800 uppercase tracking-widest">Select Color</h5>
                                                            {hasSelectedColor && <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{variantModal.selectedColor}</span>}
                                                        </div>
                                                        <div className="flex flex-wrap gap-2.5">
                                                            {uniqueColors.map(color => {
                                                                const isSelected = variantModal.selectedColor === color;
                                                                const hasStock = filteredVariants.some(v => v.color === color && (!needsSize || v.size === variantModal.selectedSize || !hasSelectedSize) && v.stock > 0);

                                                                return (
                                                                    <div key={color} className={`relative group ${!hasStock ? 'cursor-not-allowed' : ''}`}>
                                                                        <button
                                                                            disabled={!hasStock}
                                                                            onClick={() => { if(hasStock) setVariantModal(prev => ({ ...prev, selectedColor: isSelected ? null : color })) }}
                                                                            className={`px-5 py-2.5 text-sm font-bold rounded-xl border-2 transition-all duration-200 flex items-center justify-center ${isSelected ? 'border-slate-900 bg-slate-900 text-white shadow-md scale-105' : hasStock ? 'border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 bg-white hover:shadow-sm hover:-translate-y-0.5' : 'border-slate-100 text-slate-400 bg-slate-50 cursor-not-allowed opacity-60 pointer-events-none'}`}
                                                                        >
                                                                            {color}
                                                                        </button>
                                                                        {!hasStock && (
                                                                            <div className="pointer-events-none absolute -top-11 left-1/2 -translate-x-1/2 z-30 hidden w-max group-hover:block transition-all">
                                                                                <div className="rounded-xl bg-slate-900 px-3 py-1.5 text-[10px] font-bold text-white shadow-xl">      
                                                                                    Sold Out
                                                                                </div>
                                                                                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-slate-900" />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="absolute bottom-0 left-0 right-0 p-6 pt-8 bg-gradient-to-t from-white via-white to-transparent border-t-0 border-slate-100 z-20 pointer-events-none">
                                                <button
                                                    disabled={!matchedVariant || parseInt(matchedVariant.stock) <= 0}
                                                    onClick={() => {
                                                        if (matchedVariant && matchedVariant.stock > 0) {
                                                            addToCart(matchedVariant);
                                                            setVariantModal({ isOpen: false, group: null, step: 'brand', selectedBrand: null, selectedSize: null, selectedColor: null });
                                                        }
                                                    }}
                                                    className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 pointer-events-auto ${(!matchedVariant || parseInt(matchedVariant.stock) <= 0) ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-[0_10px_20px_-10px_rgba(0,0,0,0.5)] hover:shadow-[0_15px_25px_-10px_rgba(0,0,0,0.6)] hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer ring-4 ring-slate-900/10'}`}
                                                >
                                                    {!isAllSelected ? "Select Options Required" : (!matchedVariant ? "Combination Unavailable" : (matchedVariant.stock > 0 ? "Add to Cart" : "Currently Out of Stock"))}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Quotation Input Modal */}
        {showQuotationInput && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                 <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs md:max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
                    <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                            <h3 className="font-bold text-base text-gray-900">Create Quotation</h3>
                        </div>
                        <button onClick={() => setShowQuotationInput(false)} className="text-gray-400 hover:text-gray-600">
                             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div className="p-4">
                        <label className="block text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">Customer Name</label>
                        <input 
                            type="text" 
                            autoFocus
                            value={quotationCustomerName}
                            onChange={(e) => setQuotationCustomerName(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all text-sm"
                            placeholder="Enter customer name..."
                            onKeyDown={(e) => e.key === 'Enter' && handleGenerateQuotation()}
                        />
                        <p className="text-xs text-gray-500 mt-2 italic">A quotation document will be generated without deducting inventory stock.</p>
                    </div>
                    <div className="px-4 pb-4 flex justify-end gap-3">
                        <button 
                            onClick={() => setShowQuotationInput(false)}
                            className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleGenerateQuotation}
                            disabled={!quotationCustomerName.trim()}
                            style={{ backgroundColor: '#111827', color: '#ffffff' }}
                            className="px-5 py-2 font-bold rounded-xl hover:opacity-90 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2-4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2-2v4h10z"></path></svg>
                            Generate
                        </button>
                    </div>
                 </div>
            </div>
        )}

        {/* Quotation Preview Modal */}
        {showQuotationPreview && quotationData && (
            <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm md:max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-lg text-gray-800">Quotation Preview</h3>
                        <button onClick={() => setShowQuotationPreview(false)} className="text-gray-400 hover:text-gray-600">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 bg-white" id="quotation-content">
                        <div className="text-center mb-4">
                            <h2 className="text-xs font-black uppercase tracking-wider text-gray-900 mb-1">PRODUCT QUOTATION</h2>
                            <div className="text-xs text-gray-400 mt-2 space-y-1">
                                <p className="text-xl font-bold text-gray-900">Tableria La Confianza</p>
                                <p>Manila S Rd, Calamba, 4027 Laguna</p>
                                <p>Tel: (049) 545-2166</p>
                            </div>
                        </div>
                        
                        <div className="border-t border-dashed border-gray-200 py-2 mb-3 text-xs">
                            <div className="flex justify-between mb-1">
                                <span className="text-gray-500">Customer:</span>
                                <span className="font-bold text-gray-800">{quotationData.customerName}</span>
                            </div>
                            <div className="flex justify-between mb-1">
                                <span className="text-gray-500">Date:</span>
                                <span className="text-gray-800">{quotationData.date}</span>
                            </div>
                            <div className="text-xs mt-2 italic text-gray-500 text-center">
                                *Estimate only. Prices subject to change.*
                            </div>
                        </div>

                        <table className="w-full text-xs mb-4">
                            <thead>
                                <tr className="border-b-2 border-gray-100">
                                    <th className="py-2 text-left font-bold text-gray-700">Item</th>
                                    <th className="py-2 text-center font-bold text-gray-700">Qty</th>
                                    <th className="py-2 text-right font-bold text-gray-700">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-600">
                                {quotationData.items.map((item, i) => (
                                    <tr key={i} className="border-b border-gray-50">
                                        <td className="py-2">
                                            <div className="font-bold text-gray-800">{item.brand ? `${item.brand} ` : ''}{item.name}{item.color ? ` — ${item.color}` : ''}</div>
                                            <div className="text-xs">{item.code}</div>
                                        </td>
                                        <td className="py-2 text-center">{item.qty}</td>
                                        <td className="py-2 text-right">₱{(item.price * item.qty).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div className="space-y-1 text-right text-xs border-t border-gray-200 pt-2">
                            <div className="flex justify-between text-base font-black text-gray-900 pt-1 border-t border-gray-900 mt-1">
                                <span>ESTIMATED TOTAL</span>
                                <span>₱{quotationData.total.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 bg-gray-50 border-t border-gray-100 grid grid-cols-2 gap-3">
                        <button 
                            onClick={() => setShowQuotationPreview(false)}
                            className="py-2 px-4 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-100 transition-all duration-300 flex items-center justify-center gap-2 shadow-sm transform hover:-translate-y-0.5 text-gray-600 bg-white"
                            style={{ border: '2px solid #e5e7eb' }}
                        >
                            Close
                        </button>
                        <button 
                            onClick={handlePrintQuotationDoc}
                            disabled={printStatus === 'printing'}
                            className={`py-2 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 shadow-sm transform ${printStatus === 'printing' ? 'opacity-80 cursor-wait' : 'hover:opacity-90 hover:-translate-y-0.5'}`}
                            style={{ backgroundColor: printStatus === 'success' ? '#10B981' : '#111827', color: '#ffffff', border: printStatus === 'success' ? '2px solid #10B981' : '2px solid #111827' }}
                        >
                            {printStatus === 'printing' ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Printing
                                </>
                            ) : (
                                <>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2-4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2-2v4h10z"></path></svg>
                                    Print
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        )}
        </div>
    );
};

export default PointOfSale;
