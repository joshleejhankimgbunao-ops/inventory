import React, { useState, useMemo, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { showToast } from '../utils/toastHelper';
import { getAlternatives } from '../utils/recommendationLogic';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { getAuthToken } from '../services/apiClient';
import { createSaleApi } from '../services/inventoryApi';

const PointOfSale = () => {
    const { processedInventory: inventory, setInventory, logAction, logActivity, addToSyncQueue, refreshBackendData } = useInventory();
    const { appSettings: settings, currentUserName } = useAuth();

    const showErrorDetails = (message) => {
        showToast("Action Failed", message, "error", "pos-action-error");
    };

    const [cart, setCart] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [recommendationModal, setRecommendationModal] = useState({ isOpen: false, item: null, alternatives: [] }); // Recommendation Modal State
    
    // Payment State
    const [cashAmount, setCashAmount] = useState(''); // Use string for input handling
    
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
    const itemsPerPage = 15;

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
        
        // Sort: Low/Out of Stock first (ascending stock)
        return filtered.sort((a, b) => a.stock - b.stock);
    }, [inventory, searchQuery, selectedCategory]);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, selectedCategory]);

    // Get current items
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

    // Derived categories
    const categories = ['All', ...Array.from(new Set(inventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];

    const addToCart = (product, forceAdd = false) => {
        if (!forceAdd) {
            if (product.stock <= 0) {
                const alts = getAlternatives(product, inventory);
                setRecommendationModal({ isOpen: true, item: product, alternatives: alts, type: 'out-of-stock' });
                return;
            }
            // Alert for low stock (Threshold: 10)
            if (product.stock <= 10) {
                const alts = getAlternatives(product, inventory);
                setRecommendationModal({ isOpen: true, item: product, alternatives: alts, type: 'low-stock' });
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
            setRecommendationModal({ isOpen: false, item: null, alternatives: [] });
            showToast("Item Added", "Low stock item added to cart.", "success", "pos-add-cart");
        }
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
        if (cart.length === 0) return;

        // Calculate totals (Tax removed)
        const total = calculateTotal();
        let cash = parseFloat(cashAmount);

        if (isNaN(cash) || cash < total) {
            showErrorDetails("Insufficient cash amount!");
            return;
        }

        const transactionData = {
            id: `TRX-${Date.now().toString().slice(-6)}`,
            date: new Date().toLocaleString(),
            items: [...cart],
            total,
            cash: cash,
            change: cash - total,
            paymentMethod: 'Cash',
            cashier: currentUserName 
        };

        const authToken = getAuthToken();
        const isOnline = Boolean(authToken) && navigator.onLine && cart.every(item => item.id);

        try {
            if (isOnline) {
                const apiItems = cart.map(item => ({
                    productId: item.id,
                    quantity: item.qty,
                }));

                const savedSale = await createSaleApi(apiItems, 'cash');
                await refreshBackendData();

                const remoteTransaction = {
                    id: savedSale?._id ? `TRX-${savedSale._id.slice(-6).toUpperCase()}` : transactionData.id,
                    date: savedSale?.createdAt ? new Date(savedSale.createdAt).toLocaleString() : transactionData.date,
                    items: [...cart],
                    total: savedSale?.totalAmount ?? total,
                    cash,
                    change: cash - total,
                    paymentMethod: 'Cash',
                    cashier: currentUserName,
                };

                setCart([]);
                setCashAmount('');
                setLastTransaction(remoteTransaction);
                setShowReceipt(true);
                logActivity(currentUserName, 'Processed Sale', `Transaction ${remoteTransaction.id} — ₱${Number(remoteTransaction.total).toLocaleString()}`);
                showToast("Transaction Complete", "Sale recorded successfully.", "success", "pos-checkout");
                return;
            }
        } catch (error) {
            console.warn("Online sync failed, falling back to offline mode:", error);
        }

        // Queue for Sync (Offline Mode)
        // Ensure items have IDs for backend sync later
        addToSyncQueue({ ...transactionData, items: cart.map(i => ({ ...i, id: i.id || i._id })) });

        if (isOnline) {
             showToast("Offline Mode", "Transaction saved locally and will sync when online.", "info", "pos-offline-sync");
        }

        // Offline / Fallback Handling
        // Deduct stock from inventory
        const newInventory = inventory.map(item => {
            const cartItem = cart.find(c => c.code === item.code);
            if (cartItem) {
                const newStock = item.stock - cartItem.qty;
                // Update status based on new stock
                let newStatus = 'In Stock';
                if (newStock <= 10) newStatus = 'Critical';
                else if (newStock <= 50) newStatus = 'Low Stock';
                
                return { ...item, stock: newStock, status: newStatus };
            }
            return item;
        });

        setInventory(newInventory);
        
       // Log Transaction & Deduction
        cart.forEach(item => {
             logAction('DEDUCT', item.code, `Sold ${item.qty} Qty (TRX: ${transactionData.id})`, currentUserName);
        });

        setCart([]);
        setCashAmount('');
        setLastTransaction(transactionData);
        setShowReceipt(true);
        logActivity(currentUserName, 'Processed Sale', `Transaction ${transactionData.id} — ₱${total.toLocaleString()}`);
        showToast("Transaction Complete", "Sale recorded successfully.", "success", "pos-checkout");
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
    // eslint-disable-next-line
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
                                    <span>Payment</span>
                                    <span>{lastTransaction.paymentMethod || 'Cash'}</span>
                                </div>

                                <div className="flex justify-between text-gray-600 pt-1 text-[10px] font-bold">
                                    <span>Cash Tendered</span>
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
                                <p>Thank you for your business!</p>
                                <p>Please keep this receipt for warranty purposes.</p>
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
                            className={`appearance-none w-full md:w-56 px-3 py-2 rounded-xl text-sm font-bold inline-flex items-center transition-all border-2 ${selectedCategory !== 'All' ? 'bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400'}`}
                        >
                            {categories.map(cat => (
                                <option key={cat} value={cat} className="bg-white text-gray-900 py-1">{cat}</option>
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
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2.5 pb-4">
                                {currentItems.map(item => (
                                    <button
                                        key={item.code}
                                        onClick={() => addToCart(item)}
                                        className={`relative flex flex-col rounded-xl border transition-all duration-200 text-left group overflow-hidden
                                            ${item.stock <= 0 
                                                ? 'bg-red-50/50 border-red-100 opacity-80' 
                                                : 'bg-white border-gray-100 hover:shadow-md hover:border-gray-300 hover:-translate-y-0.5'
                                            }`}
                                    >
                                        {/* Top accent */}
                                        <div className={`h-0.5 ${item.stock <= 0 ? 'bg-red-200' : 'bg-gray-900'}`}></div>

                                        <div className="p-3 flex flex-col flex-1">
                                            {/* Row 1: Name (main focus) */}
                                            <h3 className="font-bold text-gray-900 text-sm leading-snug line-clamp-2 mb-1.5 group-hover:text-black transition-colors">
                                                {item.name}
                                            </h3>

                                            {/* Row 2: Brand & Color/Variant tags */}
                                            <div className="flex flex-wrap items-center gap-1 mb-2">
                                                {item.brand && (
                                                    <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{item.brand}</span>
                                                )}
                                                {item.color && (
                                                    <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{item.color}</span>
                                                )}
                                                {item.size && (
                                                    <span className="text-[10px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">{item.size}</span>
                                                )}
                                            </div>

                                            {/* Row 3: Code + Stock (small info row) */}
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-mono font-bold text-gray-400">{item.code}</span>
                                                {item.stock <= 0 ? (
                                                    <span className="text-[10px] font-bold text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded-full uppercase">Out of Stock</span>
                                                ) : (
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${item.stock <= 10 ? 'text-yellow-700 bg-yellow-50' : 'text-emerald-700 bg-emerald-50'}`}>
                                                        {item.stock} in stock
                                                    </span>
                                                )}
                                            </div>

                                            {/* Row 4: Price + Add button */}
                                            <div className="mt-auto pt-2 border-t border-gray-100 flex items-center justify-between">
                                                <span className="font-black text-gray-900 text-base">₱{item.price.toLocaleString()}</span>
                                                <div className="h-7 w-7 rounded-lg bg-gray-900 text-white flex items-center justify-center opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 shadow">
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                                                </div>
                                            </div>
                                        </div>
                                    </button>
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
            <div className="w-full md:w-80 bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300 flex flex-col min-h-[300px] md:h-full z-20">
                <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-[#111827] rounded-t-2xl shrink-0">
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                        <h3 className="font-semibold text-lg text-white">Current Order</h3>
                    </div>
                    <span className="bg-white text-[#111827] text-xs font-bold px-2 py-0.5 rounded-full">{cart.reduce((acc, item) => acc + item.qty, 0)} items</span>
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
                                    <span>@ ₱{item.price}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-3 bg-white border-t border-slate-300 rounded-b-2xl shrink-0 z-30">
                    <div className="space-y-2 mb-3 bg-gray-50/50 p-2 rounded-lg border border-gray-100">
                        {/* Cash & Change Inputs */}
                         <div className="flex justify-between items-center text-sm text-gray-600 font-bold">
                            <span>Cash Tendered</span>
                            <div className="flex items-center gap-1 border-b border-gray-300 focus-within:border-gray-900 transition-colors">
                                <span>₱</span>
                                <input 
                                    type="number" 
                                    value={cashAmount}
                                    onChange={(e) => setCashAmount(e.target.value)}
                                    onBlur={() => {
                                        const val = parseFloat(cashAmount);
                                        if (!isNaN(val)) {
                                            setCashAmount(val.toFixed(2));
                                        }
                                    }}
                                    placeholder="0.00"
                                    className="w-20 text-right bg-transparent outline-none text-gray-900 font-bold text-sm" 
                                />
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
                        <button 
                            onClick={() => setShowQuotationInput(true)}
                            disabled={cart.length === 0}
                            style={cart.length > 0 ? { backgroundColor: '#111827', color: '#ffffff', border: '2px solid #111827' } : {}}
                            className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all duration-300 flex items-center justify-center shadow-md transform hover:-translate-y-0.5
                                ${cart.length === 0 
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none transform-none' 
                                    : ''
                                }`}
                        >
                            Quotation
                        </button>
                        <button 
                            onClick={handleCheckout}
                            disabled={cart.length === 0 || !cashAmount}
                            style={(cart.length > 0 && cashAmount) ? { backgroundColor: '#111827', color: '#ffffff', border: '2px solid #111827' } : {}}
                            className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all duration-300 flex items-center justify-center shadow-xl transform hover:-translate-y-0.5
                                ${cart.length === 0 || !cashAmount
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none transform-none' 
                                    : ''
                                }`}
                        >
                            Process Payment
                        </button>
                    </div>
                </div>
            </div>
        </div>
        
        {/* Recommendation Modal */}
        {recommendationModal.isOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <div className="bg-white w-full max-w-xl md:max-w-2xl rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                    <div className={`p-3 border-b ${recommendationModal.type === 'out-of-stock' ? 'bg-red-50 border-red-100' : 'bg-yellow-50 border-yellow-100'}`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`p-1.5 rounded-lg ${recommendationModal.type === 'out-of-stock' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600'}`}>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className={`text-base font-black tracking-tight ${recommendationModal.type === 'out-of-stock' ? 'text-red-900' : 'text-yellow-900'}`}>
                                        {recommendationModal.type === 'out-of-stock' ? 'Item Out of Stock' : 'Low Stock Warning'}
                                    </h3>
                                    <p className={`text-xs font-medium mt-0 ${recommendationModal.type === 'out-of-stock' ? 'text-red-700' : 'text-yellow-700'}`}>
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
                            Recommended Alternatives
                        </h4>
                        
                        {recommendationModal.alternatives.length > 0 ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {recommendationModal.alternatives.map(alt => (
                                    <div 
                                        key={alt.code} 
                                        className="group p-3 rounded-xl border border-gray-100 hover:border-[#111827] hover:shadow-md transition-all cursor-pointer relative bg-gray-50 hover:bg-white flex flex-col h-full overflow-hidden"
                                        onClick={() => {
                                            addToCart(alt);
                                            setRecommendationModal({ isOpen: false, item: null, alternatives: [] });
                                            showToast(
                                                'Selected Alternative',
                                                `${alt.brand ? alt.brand + ' ' : ''}${alt.name}${alt.color ? ` — ${alt.color}` : ''}`,
                                                'success',
                                                'pos-selected-alternative'
                                            );
                                        }}
                                    >
                                        {/* Decorative Top Gradient Line */}
                                        <div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-gray-700 to-black"></div>

                                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <span className="text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md transform scale-105" style={{ backgroundColor: '#111827' }}>SELECT</span>
                                        </div>
                                        
                                        <div className="mb-2 mt-1">
                                            <h5 className="text-sm font-black text-gray-900 group-hover:text-[#111827] leading-tight mb-1">
                                                {alt.brand && <span className="text-gray-400 font-bold">{alt.brand} </span>}
                                                {alt.name}
                                                {alt.color && <span className="text-gray-400 font-medium"> — {alt.color}</span>}
                                            </h5>
                                            <p className="text-xs font-bold text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded inline-block">{alt.code}</p>
                                        </div>
                                        
                                        <div className="mt-auto space-y-1">
                                            <div className="flex justify-between items-end border-b border-gray-200 pb-1">
                                                <span className="text-xs font-bold text-gray-500">Size</span>
                                                <span className="text-sm font-bold text-gray-900">{alt.size}</span>
                                            </div>
                                            <div className="flex justify-between items-end">
                                                <div>
                                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Price</p>
                                                    <p className="text-base font-black text-gray-900">₱{alt.price.toLocaleString()}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Available</p>
                                                    <p className={`text-sm font-black ${alt.stock < 20 ? 'text-yellow-600' : 'text-green-600'}`}>{alt.stock}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
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
        {/* Quotation Input Modal */}
        {showQuotationInput && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                 <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm md:max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
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
                        <label className="block text-sm font-bold text-gray-700 mb-2">Customer Name</label>
                        <input 
                            type="text" 
                            autoFocus
                            value={quotationCustomerName}
                            onChange={(e) => setQuotationCustomerName(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all text-sm"
                            placeholder="Enter customer name..."
                            onKeyDown={(e) => e.key === 'Enter' && handleGenerateQuotation()}
                        />
                        <p className="text-xs text-gray-500 mt-2 italic">A quotation document will be generated without deducting inventory stock.</p>
                    </div>
                    <div className="px-4 pb-4 flex justify-end gap-3">
                        <button 
                            onClick={() => setShowQuotationInput(false)}
                            className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleGenerateQuotation}
                            disabled={!quotationCustomerName.trim()}
                            style={{ backgroundColor: '#111827', color: '#ffffff' }}
                            className="px-6 py-2.5 font-bold rounded-xl hover:opacity-90 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md md:max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                    <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-xl text-gray-800">Quotation Preview</h3>
                        <button onClick={() => setShowQuotationPreview(false)} className="text-gray-400 hover:text-gray-600">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-8 bg-white" id="quotation-content">
                        <div className="text-center mb-6">
                            <h2 className="text-xs font-black uppercase tracking-wider text-gray-900 mb-1">PRODUCT QUOTATION</h2>
                            <div className="text-xs text-gray-400 mt-2 space-y-1">
                                <p className="text-2xl font-bold text-gray-900">Tableria La Confianza</p>
                                <p>Manila S Rd, Calamba, 4027 Laguna</p>
                                <p>Tel: (049) 545-2166</p>
                            </div>
                        </div>
                        
                        <div className="border-t-2 border-dashed border-gray-200 py-4 mb-4 text-sm">
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

                        <table className="w-full text-sm mb-6">
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

                        <div className="space-y-2 text-right text-sm border-t border-gray-200 pt-4">
                            <div className="flex justify-between text-xl font-black text-gray-900 pt-2 border-t-2 border-gray-900 mt-2">
                                <span>ESTIMATED TOTAL</span>
                                <span>₱{quotationData.total.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="p-6 bg-gray-50 border-t border-gray-100 grid grid-cols-2 gap-4">
                        <button 
                            onClick={() => setShowQuotationPreview(false)}
                            className="py-3 px-6 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-gray-100 transition-all duration-300 flex items-center justify-center gap-3 shadow-xl transform hover:-translate-y-1 text-gray-600 bg-white"
                            style={{ border: '2px solid #e5e7eb' }}
                        >
                            Close
                        </button>
                        <button 
                            onClick={handlePrintQuotationDoc}
                            disabled={printStatus === 'printing'}
                            className={`py-3 px-6 rounded-xl text-sm font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-3 shadow-xl transform ${printStatus === 'printing' ? 'opacity-80 cursor-wait' : 'hover:opacity-90 hover:-translate-y-1'}`}
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