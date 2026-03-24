import React, { useState, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { showToast } from '../utils/toastHelper';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

const EyeIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.25 12s3.75-7.5 9.75-7.5 9.75 7.5 9.75 7.5-3.75 7.5-9.75 7.5S2.25 12 2.25 12Z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const EyeOffIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3l18 18" />
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
        <path d="M6.2 6.2C3.8 8 2.25 12 2.25 12s3.75 7.5 9.75 7.5c2.1 0 3.9-.5 5.4-1.3" />
        <path d="M14.1 4.8c4.5.9 7.65 5.7 7.65 7.2 0 0-1.05 2.1-3 3.95" />
    </svg>
);

const Profile = () => {
    const { appSettings: settings, updateSettings, userRole, ROLES, roleNames } = useAuth();
    const { renameUserReferences } = useInventory();
    
    // Internal handler to replace onSave prop
    const handleSaveInternal = (newSettings) => {
         // Check for name change (Admin only usually, or if logic allows)
         if (newSettings.adminDisplayName !== settings.adminDisplayName) {
             renameUserReferences(settings.adminDisplayName, newSettings.adminDisplayName);
         }
         updateSettings(newSettings);
    };

    const handleAutoPrintToggle = () => {
        const nextAutoPrint = !autoPrint;
        setAutoPrint(nextAutoPrint);
        handleSaveInternal({ ...settings, autoPrintReceipts: nextAutoPrint });
    };

    // Local state for form fields, initialized from global settings
    const [profileData, setProfileData] = useState(() => {
        if (userRole === ROLES.CASHIER) {
            const savedCashier = localStorage.getItem('cashierProfile');
            if (savedCashier) {
                const data = JSON.parse(savedCashier);
                data.adminPassword = '';
                return data;
            }
            return {
                adminUser: 'cashier',
                adminDisplayName: 'Cashier Account',
                adminPassword: '',
                role: 'Cashier',
                email: 'cashier@tableria.com',
                bio: 'Authorized staff member for point of sale and inventory management.',
                avatar: null
            };
        }
        if (userRole === ROLES.ADMIN) {
            // look up current user from stored users list
            const users = JSON.parse(localStorage.getItem('users') || '[]');
            const username = sessionStorage.getItem('userName');
            const me = users.find(u => u.name === username || u.username === username) || {};
            return {
                adminUser: me.username || '',
                adminDisplayName: me.name || '',
                adminPassword: '',
                role: roleNames[userRole] || 'Admin',
                email: me.email || '',
                bio: me.bio || '',
                avatar: me.avatar || null,
                pin: me.pin || ''
            };
        }
        // super admin default from settings
        return {
            adminUser: settings.adminUser || 'Admin User',
            adminDisplayName: settings.adminDisplayName || settings.adminUser || 'Admin User',
            adminPassword: '',
            role: roleNames[userRole] || 'Super Admin',
            email: settings.storePrimaryEmail || 'admin@example.com',
            bio: 'Managing the store inventory and sales.',
            avatar: settings.avatar || null
        };
    });

    const fileInputRef = useRef(null);
    const [previewImage, setPreviewImage] = useState(null); // For cropping preview
    const [zoom, setZoom] = useState(1);
    const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
    const [showPassword, setShowPassword] = useState(false);
    // name shown under avatar should update only after saving
    const [avatarName, setAvatarName] = useState(profileData.adminDisplayName);
    // remember original login name so we can remove the old value after a change
    const originalUsernameRef = useRef(profileData.adminUser);
    const [currentPassword, setCurrentPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [oldPin, setOldPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    // visibility toggles for password and PIN inputs (only current/new fields)
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showOldPin, setShowOldPin] = useState(false);
    const [showNewPin, setShowNewPin] = useState(false);

    // determine current stored PIN so we can give real‑time feedback
    const storedPinValue = userRole === ROLES.CASHIER
        ? ((JSON.parse(localStorage.getItem('cashierProfile')||'{}')).adminPin || '123456')
        : (settings.adminPin || '123456');
    const validCurrentPin = oldPin && oldPin.toString().toLowerCase() === storedPinValue.toString().toLowerCase();

    // same idea for the current password field
    const storedPasswordValue = userRole === ROLES.CASHIER
        ? ((JSON.parse(localStorage.getItem('cashierProfile')||'{}')).adminPassword || '123456')
        : userRole === ROLES.ADMIN
            ? (() => {
                const users = JSON.parse(localStorage.getItem('users') || '[]');
                const username = sessionStorage.getItem('userName');
                const me = users.find(u => u.name === username || u.username === username) || {};
                return me.password || '123456';
            })()
            : (settings.adminPassword || '123456');
    const validCurrentPassword = currentPassword && currentPassword === storedPasswordValue;
    const passwordChecks = {
        length: profileData.adminPassword.length >= 8,
        lowercase: /[a-z]/.test(profileData.adminPassword),
        uppercase: /[A-Z]/.test(profileData.adminPassword),
        number: /\d/.test(profileData.adminPassword),
        special: /[^A-Za-z\d]/.test(profileData.adminPassword),
    };
    const allPasswordChecksMet = Object.values(passwordChecks).every(Boolean);

    const [autoPrint, setAutoPrint] = useState(settings.autoPrintReceipts || false);
    const isDragging = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });

    const isModified = React.useMemo(() => {
        const pinChanged = newPin && newPin === confirmPin;
        // password change detection
        // use the same value that we use for validity indicator
        const correctPassword = storedPasswordValue;
        // determine if password fields are being used correctly; we want the button
        // enabled when the user *attempts* a password change, even if the new value
        // happens to equal the stored one.
        const passChanged = profileData.adminPassword && profileData.adminPassword !== correctPassword;
        const hasPasswordInput = Boolean(profileData.adminPassword || confirmPassword || currentPassword);
        const passwordAttempt = Boolean(
            passChanged &&
            allPasswordChecksMet &&
            profileData.adminPassword &&
            profileData.adminPassword === confirmPassword &&
            currentPassword &&
            currentPassword === correctPassword
        );
        // short-circuit: only count as modified when all three password fields are
        // filled correctly (current valid, new=confirm). typing the new password
        // alone or current+new should not enable the button.
        if (passwordAttempt) {
            return true;
        }
        if (hasPasswordInput && !passwordAttempt) {
            return false;
        }
        // require currentPassword to be provided and match when changing password
        const validPassword = !passChanged || (currentPassword && currentPassword === correctPassword);
        // only treat pin change as modified if current PIN is correct too
        const storedPin = userRole === ROLES.CASHIER
            ? ((JSON.parse(localStorage.getItem('cashierProfile')||'{}')).adminPin || '123456')
            : (settings.adminPin || '123456');
        const validPin = oldPin && oldPin.toString().toLowerCase() === storedPin.toString().toLowerCase();
        if (userRole === 'cashier') {
            const savedCashier = localStorage.getItem('cashierProfile');
            const initial = savedCashier ? JSON.parse(savedCashier) : {
               adminUser: 'Cashier',
               adminDisplayName: 'Cashier Account',
               adminPassword: '123456',
               role: 'Cashier',
               email: 'cashier@tableria.com',
               bio: 'Authorized staff member for point of sale and inventory management.',
               avatar: null
            };
            // if incorrect pin entered, disable modification flag
            if (oldPin && !validPin) {
                return false;
            }
            // also disable if password changed but current password wrong
            if (passChanged && !validPassword) {
                return false;
            }
            return (
               profileData.adminUser !== initial.adminUser ||
               profileData.adminDisplayName !== initial.adminDisplayName ||
               profileData.email !== initial.email ||
               profileData.bio !== initial.bio ||
               // password field counts only when the user has entered a complete
               // valid password change (new + confirm match and current correct)
               (passwordAttempt) ||
               profileData.avatar !== initial.avatar ||
               autoPrint !== settings.autoPrintReceipts ||
               (pinChanged && validPin)
            );
       }
       
       if (userRole === ROLES.ADMIN) {
           const users = JSON.parse(localStorage.getItem('users') || '[]');
           const username = sessionStorage.getItem('userName');
           const me = users.find(u => u.name === username || u.username === username) || {};

           const initialAvatar = me.avatar || null;
           const currentAvatar = profileData.avatar || null;
           const adminStoredPin = me.pin || '123456';
           const validPinAdmin = oldPin && oldPin.toString().toLowerCase() === adminStoredPin.toString().toLowerCase();

           if (oldPin && !validPinAdmin) {
               return false;
           }
           if (passChanged && !validPassword) {
               return false;
           }

           return (
               profileData.adminUser !== (me.username || '') ||
               profileData.adminDisplayName !== (me.name || '') ||
               profileData.email !== (me.email || '') ||
               profileData.bio !== (me.bio || '') ||
               (passwordAttempt) ||
               currentAvatar !== initialAvatar ||
               autoPrint !== settings.autoPrintReceipts ||
               (pinChanged && validPinAdmin)
           );
       }

       const initialAvatar = settings.avatar || null;
       const currentAvatar = profileData.avatar || null;
       const adminStoredPin = settings.adminPin || '123456';
       const validPinAdmin = oldPin && oldPin.toString().toLowerCase() === adminStoredPin.toString().toLowerCase();
       if (oldPin && !validPinAdmin) {
           return false;
       }
       if (passChanged && !validPassword) {
           return false;
       }
       return (
           profileData.adminUser !== (settings.adminUser || 'Admin User') ||
           profileData.adminDisplayName !== (settings.adminDisplayName || settings.adminUser || 'Admin User') ||
           profileData.email !== (settings.storePrimaryEmail || 'admin@example.com') ||
           profileData.bio !== (settings.bio || 'Managing the store inventory and sales.') ||
           (passwordAttempt) ||
           currentAvatar !== initialAvatar ||
           autoPrint !== settings.autoPrintReceipts ||
           (pinChanged && validPinAdmin)
       );
    }, [profileData, settings, userRole, autoPrint, newPin, confirmPin, oldPin, currentPassword, confirmPassword, allPasswordChecksMet, storedPasswordValue]);

    const handleSave = () => {
        if (profileData.adminPassword && profileData.adminPassword !== confirmPassword) {
            showToast('Error', 'Passwords do not match!', 'error');
            return; 
        }
        if (profileData.adminPassword && !PASSWORD_RULE.test(profileData.adminPassword)) {
            showToast('Weak Password', 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.', 'error');
            return;
        }
        // password change verification
        if (profileData.adminPassword && profileData.adminPassword !== '' && profileData.adminPassword !== storedPasswordValue) {
            // user entered a different new password - require current password
            const correct = userRole === ROLES.CASHIER 
                ? (JSON.parse(localStorage.getItem('cashierProfile')||'{}')).adminPassword 
                : userRole === ROLES.ADMIN
                    ? (() => {
                        const users = JSON.parse(localStorage.getItem('users') || '[]');
                        const username = sessionStorage.getItem('userName');
                        const me = users.find(u => u.name === username || u.username === username) || {};
                        return me.password || '';
                    })()
                    : storedPasswordValue;
            if (currentPassword !== correct) {
                showToast('Error', 'Current password is incorrect.', 'error');
                return;
            }
        }
        // PIN change validation
        if (newPin) {
            if (newPin !== confirmPin) {
                showToast('Error', 'New PIN entries do not match.', 'error');
                return;
            }
            // verify oldPin matches stored value before proceeding
            if (userRole === 'cashier') {
                const savedCashier = JSON.parse(localStorage.getItem('cashierProfile') || '{}');
                const stored = savedCashier.adminPin || '123456';
                if (oldPin.toString().toLowerCase() !== stored.toString().toLowerCase()) {
                    showToast('Error', 'Current PIN is incorrect.', 'error');
                    return;
                }
            } else {
                const stored = settings.adminPin || '123456';
                if (oldPin.toString().toLowerCase() !== stored.toString().toLowerCase()) {
                    showToast('Error', 'Current PIN is incorrect.', 'error');
                    return;
                }
            }
        }
        // if user entered a current PIN but isn't changing it, still verify correctness
        if (oldPin && !newPin) {
            if (userRole === 'cashier') {
                const savedCashier = JSON.parse(localStorage.getItem('cashierProfile') || '{}');
                const stored = savedCashier.adminPin || '123456';
                if (oldPin.toString().toLowerCase() !== stored.toString().toLowerCase()) {
                    showToast('Error', 'Current PIN is incorrect.', 'error');
                    return;
                }
            } else {
                const stored = settings.adminPin || '123456';
                if (oldPin.toString().toLowerCase() !== stored.toString().toLowerCase()) {
                    showToast('Error', 'Current PIN is incorrect.', 'error');
                    return;
                }
            }
        }

        if (userRole === 'cashier') {
            // PIN update if requested
            if (newPin) {
                const storedCashier = JSON.parse(localStorage.getItem('cashierProfile') || '{}');
                storedCashier.adminPin = newPin;
                localStorage.setItem('cashierProfile', JSON.stringify(storedCashier));
                // also update the local state so we don't overwrite it below
                profileData.adminPin = newPin;
                // clear PIN inputs so they don't linger
                setOldPin('');
                setNewPin('');
                setConfirmPin('');
            }

            // Check for name change and update logs
            const savedCashier = localStorage.getItem('cashierProfile');
            const oldName = savedCashier ? (JSON.parse(savedCashier).adminDisplayName || 'Cashier') : 'Cashier';
            const newName = profileData.adminDisplayName;

            if (oldName !== newName) {
                renameUserReferences(oldName, newName);
            }

            // avoid wiping out existing password if user left field blank
            if ((!profileData.adminPassword || profileData.adminPassword === '') && savedCashier) {
                const existing = JSON.parse(savedCashier);
                profileData.adminPassword = existing.adminPassword || '';
            }
            // also preserve existing PIN if we didn't just set a new one
            if (!newPin && savedCashier) {
                try {
                    const existing = JSON.parse(savedCashier);
                    if (existing.adminPin !== undefined && !profileData.adminPin) {
                        profileData.adminPin = existing.adminPin;
                    }
                } catch(e) {}
            }
            localStorage.setItem('cashierProfile', JSON.stringify(profileData));
            // persist previous username to block it after saving
            if (originalUsernameRef.current && originalUsernameRef.current !== profileData.adminUser) {
                localStorage.setItem('cashierOldUser', originalUsernameRef.current);
                const cleaned = JSON.parse(localStorage.getItem('users') || '[]').filter(u => u.username !== originalUsernameRef.current);
                localStorage.setItem('users', JSON.stringify(cleaned));
            }

            // Check for name change involving historical data
            let oldCashierName = '';
            try {
                if (savedCashier) {
                    const sc = JSON.parse(savedCashier);
                    oldCashierName = sc.adminDisplayName;
                }
            } catch (e) {}

            if (oldCashierName && oldCashierName !== profileData.adminDisplayName) {
                renameUserReferences(oldCashierName, profileData.adminDisplayName);
            }

            // Also update Auto Print only
            handleSaveInternal({ ...settings, autoPrintReceipts: autoPrint });

            // update avatar name display immediately
            setAvatarName(profileData.adminDisplayName);
            // update stored display name for next login
            sessionStorage.setItem('lastLoginUser', profileData.adminUser || '');

            if (newPin) {
                showToast('Success', 'Cashier profile and PIN updated! Use the new PIN on your next login.', 'save', 'profile-save');
            } else {
                showToast('Success', 'Cashier profile updated successfully!', 'save', 'profile-save');
            }
            // update reference for subsequent saves
            originalUsernameRef.current = profileData.adminUser;
            // clear stored old user if we just reset back to it (unlikely)
            const savedOld = localStorage.getItem('cashierOldUser');
            if (savedOld && savedOld === profileData.adminUser) {
                localStorage.removeItem('cashierOldUser');
            }
            return;
        }
        
        // Update global settings (include PIN if changed)
        if (userRole === ROLES.ADMIN) {
            // update user record in localStorage (include username change!)
            const users = JSON.parse(localStorage.getItem('users') || '[]');
            const username = sessionStorage.getItem('userName');
            
            if (username && username !== profileData.adminDisplayName) {
                renameUserReferences(username, profileData.adminDisplayName);
            }

            const updated = users.map(u => {
                if (u.name === username || u.username === username) {
                    return {
                        ...u,
                        username: profileData.adminUser,                // persist new login name
                        name: profileData.adminDisplayName,
                        email: profileData.email,
                        bio: profileData.bio,
                        avatar: profileData.avatar,
                        pin: newPin || profileData.pin || u.pin,
                        password: profileData.adminPassword || u.password
                    };
                }
                return u;
            });
            localStorage.setItem('users', JSON.stringify(updated));
            // update session name (display name stays separate)
            sessionStorage.setItem('userName', profileData.adminDisplayName);
        } else {
            const updatedSettings = {
                ...settings,
                adminUser: profileData.adminUser,
                adminDisplayName: profileData.adminDisplayName,
                adminPassword: profileData.adminPassword || storedPasswordValue,
                storePrimaryEmail: profileData.email,
                bio: profileData.bio,
                avatar: profileData.avatar,
                autoPrintReceipts: autoPrint
            };
            if (newPin) {
                updatedSettings.adminPin = newPin;
            }
            handleSaveInternal(updatedSettings);
            // if we're the superadmin, also refresh the session name so header picks it up
            if (userRole === ROLES.SUPER_ADMIN) {
                sessionStorage.setItem('userName', profileData.adminDisplayName);
            }
        }

        // update avatar name display
        setAvatarName(profileData.adminDisplayName);
        // update ref so we no longer consider the old username next save
        originalUsernameRef.current = profileData.adminUser;

        // if PIN was changed, also update local component state and clear PIN fields
        if (newPin) {
            setProfileData(prev => ({ ...prev, adminPin: newPin }));
            setOldPin('');
            setNewPin('');
            setConfirmPin('');
            // give the user a little extra guidance
            showToast('Success', 'Profile and PIN updated! Please use the new PIN on your next login.', 'save', 'profile-save');
            // reload after a short delay so the user can read the toast
            setTimeout(() => window.location.reload(), 1000);
            return;
        }

        // for admin/super‑admin the page didn't auto‑refresh yet, so do it now
        showToast('Success', 'Profile updated successfully!', 'save', 'profile-save');
        // reload so changes (name/avatar/etc) take effect immediately
        setTimeout(() => window.location.reload(), 800);
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreviewImage(reader.result);
                setZoom(1);
                setCropOffset({ x: 0, y: 0 });
            };
            reader.readAsDataURL(file);
        }
    };

    const confirmImage = () => {
        // Create a canvas to crop the image
        const canvas = document.createElement('canvas');
        const size = 300; // Final avatar size
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const img = new Image();
        img.src = previewImage;
        img.onload = () => {
            // Draw logic: render the visible portion of the image onto the canvas
            // We need to map the visual scaling/panning to the canvas
            
            // Clear
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, size, size);

            // Calculate draw dimensions
            // The container is 256px (w-64). The image is scaled by `zoom`.
            // We want to capture what's inside the 256px circle, but output at 300px resolution.
            
            const scaleFactor = size / 256; // Ratio between output and UI
            
            // Visual Width/Height of image
            const visualW = img.width * (256 / img.width) * zoom; // This is wrong if aspect ratio differs.
            // Let's assume object-cover logic:
            const aspect = img.width / img.height;
            let drawW, drawH;
            
            if (aspect > 1) {
                // Landscape
                drawH = size * zoom;
                drawW = drawH * aspect;
            } else {
                // Portrait
                drawW = size * zoom;
                drawH = drawW / aspect;
            }

            // Center offset
            const centerX = (size - drawW) / 2;
            const centerY = (size - drawH) / 2;

            // Apply user offset (scaled)
            const offsetX = cropOffset.x * scaleFactor;
            const offsetY = cropOffset.y * scaleFactor;

            ctx.drawImage(img, centerX + offsetX, centerY + offsetY, drawW, drawH);

            setProfileData({ ...profileData, avatar: canvas.toDataURL('image/jpeg', 0.9) });
            setPreviewImage(null);
        };
    };

    // Mouse handlers for dragging
    const handleMouseDown = (e) => {
        isDragging.current = true;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e) => {
        if (!isDragging.current) return;
        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        setCropOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    };

    const handleMouseUp = () => {
        isDragging.current = false;
    };

    return (
        <div className="h-full flex flex-col p-4 max-w-4xl mx-auto overflow-y-auto relative">
            
            {/* Simple Image Confirmation Modal */}
            {previewImage && (
                <div 
                    className="absolute inset-0 z-50 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-8 rounded-3xl"
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    <h3 className="text-xl font-black text-gray-900 mb-2">Adjust Profile Picture</h3>
                    <p className="text-xs text-gray-500 font-bold mb-6 uppercase tracking-wider">Drag to Move • Slider to Zoom</p>
                    
                    <div 
                        className="w-64 h-64 rounded-full border-4 border-gray-900 shadow-2xl overflow-hidden mb-6 relative bg-gray-100 cursor-move"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                    >
                        <img 
                            src={previewImage} 
                            alt="Preview" 
                            className="w-full h-full object-cover pointer-events-none transition-transform duration-75"
                            style={{ 
                                transform: `translate(${cropOffset.x}px, ${cropOffset.y}px) scale(${zoom})` 
                            }}
                            draggable="false"
                        />
                    </div>

                    <div className="w-64 mb-8 flex items-center gap-4">
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4"></path></svg>
                        <input 
                            type="range" 
                            min="1" 
                            max="3" 
                            step="0.1" 
                            value={zoom} 
                            onChange={(e) => setZoom(parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-900"
                        />
                        <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                    </div>

                    <div className="flex gap-4">
                        <button 
                            onClick={() => setPreviewImage(null)}
                            className="px-6 py-2 rounded-xl font-bold uppercase tracking-wider text-xs text-black shadow-lg transition-all hover:opacity-90 transform hover:-translate-y-0.5"
                            style={{ backgroundColor: 'transparent', border: '2px solid #000000' }}
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={confirmImage}
                            className="px-6 py-2 rounded-xl font-bold uppercase tracking-wider text-xs text-white shadow-lg transition-all hover:opacity-90 transform hover:-translate-y-0.5"
                            style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                        >
                            Save & Apply
                        </button>
                    </div>
                </div>
            )}
            
            {/* Header */}
            <div className="mb-8 flex items-center gap-4">
                <div className="bg-gray-900 text-white p-3 rounded-2xl shadow-lg hidden sm:block">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                </div>
                <div>
                    <h1 className="text-2xl font-black text-gray-900 leading-tight">My Profile</h1>
                    <p className="text-gray-500 text-sm font-medium mt-1">Manage your personal information and security.</p>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-8">
                
                {/* Left Column: Avatar Card */}
                <div className="w-full md:w-1/3">
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col items-center text-center">
                        <div className="relative group">
                            <div className={`w-32 h-32 rounded-full bg-gray-100 border-4 border-white shadow-lg overflow-hidden mb-4 relative cursor-pointer`}>
                                {profileData.avatar ? (
                                    <img src={profileData.avatar} alt="Profile" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gray-800 text-white text-4xl font-bold">
                                        {profileData.adminDisplayName ? profileData.adminDisplayName.charAt(0).toUpperCase() : 'U'}
                                    </div>
                                )}
                                
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" onClick={() => fileInputRef.current.click()}>
                                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                </div>
                            </div>
                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                        </div>
                        
                        <h2 className="text-lg font-bold text-gray-900">{avatarName}</h2>
                        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full mt-2">
                            {profileData.role || (roleNames[userRole] || (userRole === ROLES.CASHIER ? 'Staff' : 'Super Admin'))}
                        </span>
                    </div>
                </div>

                {/* Right Column: Edit Form */}
                <div className="w-full md:w-2/3">
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
                        
                        <div className="border-b border-gray-100 pb-4 mb-4">
                            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.121 17.804A13.937 13.937 0 0112 15c2.761 0 5.303.896 7.379 2.404M15 10a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                Personal Details
                            </h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Display Name</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                    </div>
                                    <input 
                                        type="text" 
                                        value={profileData.adminDisplayName}
                                        onChange={(e) => setProfileData({...profileData, adminDisplayName: e.target.value})}
                                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                                    />
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1">Name shown in the app and on receipts.</p>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Email Address</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                                    </div>
                                    <input 
                                        type="text" 
                                        value={profileData.email}
                                        onChange={(e) => setProfileData({...profileData, email: e.target.value})}
                                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                                    />
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1">Primary contact email for account notifications.</p>
                            </div>
                            
                            {/* Short Bio Removed */}
                        </div>

                        <div className="border-b border-gray-100 pb-4 mb-4 mt-8">
                            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                Preferences
                            </h3>
                        </div>

                        <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-200">
                             <div>
                                 <h4 className="text-sm font-bold text-gray-900">Automatic Printing</h4>
                                 <p className="text-xs text-gray-500 font-medium">Automatically print receipt after transaction completes</p>
                             </div>
                             <button
                                          type="button"
                                          onClick={handleAutoPrintToggle}
                                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none border-2 ${autoPrint ? 'bg-gray-100 border-gray-100' : 'bg-gray-200 border-gray-200'}`}
                             >
                                <span className={`inline-block h-5 w-5 transform rounded-full shadow-md transition-transform ${autoPrint ? 'translate-x-6 bg-black' : 'translate-x-0.5 bg-white'}`} />
                             </button>
                        </div>
                        
                        <div className="border-b border-gray-100 pb-4 mb-4 mt-8">
                            <h3 className="text-sm font-bold text-red-500 uppercase tracking-wider flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                                Security & Login
                            </h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Username (Login)</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                    </div>
                                    <input 
                                        type="text" 
                                        value={profileData.adminUser}
                                        onChange={(e) => setProfileData({...profileData, adminUser: e.target.value})}
                                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                                    />
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1">This is your login username and cannot be changed later.</p>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Current Password</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                                    </div>
                                    <input
                                        name="currentPassword"
                                        autoComplete="new-password"
                                        type={showCurrentPassword ? 'text' : 'password'}
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        placeholder="Enter current password"
                                        className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border ${
                                            currentPassword
                                                ? validCurrentPassword
                                                    ? 'border-green-300 focus:ring-green-200'
                                                    : 'border-red-300 focus:ring-red-200'
                                                : 'border-gray-200 focus:ring-gray-900'
                                        } rounded-xl text-sm text-gray-900 focus:ring-2 outline-none`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                                    >
                                        {showCurrentPassword ? <EyeOffIcon /> : <EyeIcon />}
                                    </button>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1">Enter your current password before changing it.</p>
                                {currentPassword && !validCurrentPassword && (
                                    <p className="text-[10px] text-red-500 mt-1">
                                        Current password doesn’t match stored value
                                        <span className="font-bold"> (stored: {storedPasswordValue})</span>.
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">New Password</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                                    </div>
                                    <input 
                                        name="newPassword"
                                        autoComplete="new-password"
                                        type={showPassword ? "text" : "password"}
                                        value={profileData.adminPassword}
                                        onChange={(e) => setProfileData({...profileData, adminPassword: e.target.value})}
                                        placeholder="Enter new password"
                                        className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border rounded-xl text-sm text-gray-900 focus:ring-2 outline-none ${
                                            profileData.adminPassword
                                                ? allPasswordChecksMet
                                                    ? 'border-green-300 focus:ring-green-200'
                                                    : 'border-red-300 focus:ring-red-200'
                                                : 'border-gray-200 focus:ring-gray-900'
                                        }`}
                                    />
                                    <button 
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                                    >
                                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                                    </button>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1">Choose a strong password; you will need to re-enter it below.</p>
                                
                                {profileData.adminPassword && (
                                    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                                        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1.5">Password Requirements</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                            <div className={`text-[10px] flex items-center gap-1.5 ${passwordChecks.length ? 'text-green-700' : 'text-gray-500'}`}>
                                                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${passwordChecks.length ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{passwordChecks.length ? '✓' : '•'}</span>
                                                At least 8 characters
                                            </div>
                                            <div className={`text-[10px] flex items-center gap-1.5 ${passwordChecks.lowercase ? 'text-green-700' : 'text-gray-500'}`}>
                                                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${passwordChecks.lowercase ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{passwordChecks.lowercase ? '✓' : '•'}</span>
                                                Has lowercase letter
                                            </div>
                                            <div className={`text-[10px] flex items-center gap-1.5 ${passwordChecks.uppercase ? 'text-green-700' : 'text-gray-500'}`}>
                                                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${passwordChecks.uppercase ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{passwordChecks.uppercase ? '✓' : '•'}</span>
                                                Has uppercase letter
                                            </div>
                                            <div className={`text-[10px] flex items-center gap-1.5 ${passwordChecks.number ? 'text-green-700' : 'text-gray-500'}`}>
                                                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${passwordChecks.number ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{passwordChecks.number ? '✓' : '•'}</span>
                                                Has number
                                            </div>
                                            <div className={`text-[10px] flex items-center gap-1.5 ${passwordChecks.special ? 'text-green-700' : 'text-gray-500'}`}>
                                                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${passwordChecks.special ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{passwordChecks.special ? '✓' : '•'}</span>
                                                Has special character
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="md:col-start-2">
                                <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Confirm Password</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                                    </div>
                                    <input 
                                        name="confirmPassword"
                                        autoComplete="new-password"
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="Confirm new password"
                                        className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border ${
                                            confirmPassword
                                                ? profileData.adminPassword === confirmPassword
                                                    ? 'border-green-300 focus:ring-green-200'
                                                    : 'border-red-300 focus:ring-red-200'
                                                : 'border-gray-200 focus:ring-gray-900'
                                        } rounded-xl text-sm text-gray-900 focus:ring-2 outline-none`}
                                    />
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1">Re-type the new password exactly as above.</p>
                            </div>
                    </div> {/* end security/login grid */}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        <div className="md:col-span-2 border-t border-gray-100 pt-4 mt-8">
                            <h4 className="text-sm font-bold text-red-500 uppercase tracking-wider flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                Change Security PIN
                            </h4>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Current PIN</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                                </div>
                                <input
                                    type={showOldPin ? 'text' : 'password'}
                                    value={oldPin}
                                    onChange={e => setOldPin(e.target.value.replace(/[^0-9]/g, ''))}
                                    placeholder="Enter current PIN"
                                    maxLength={6}
                                    className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border ${
                                        oldPin
                                            ? validCurrentPin
                                                ? 'border-green-300 focus:ring-green-200'
                                                : 'border-red-300 focus:ring-red-200'
                                            : 'border-gray-200 focus:ring-gray-900'
                                    } rounded-xl text-sm font-bold text-gray-900 focus:ring-2 outline-none`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowOldPin(!showOldPin)}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                                >
                                    {showOldPin ? <EyeOffIcon /> : <EyeIcon />}
                                </button>
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1">Provide your existing 6-digit security PIN to make changes.</p>
                            {oldPin && !validCurrentPin && (
                                <p className="text-[10px] text-red-500 mt-1">
                                    Current PIN doesn’t match stored value
                                    {/* reveal for convenience */}
                                    <span className="font-bold"> (stored: {storedPinValue})</span>.
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">New PIN</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                                </div>
                                <input
                                    type={showNewPin ? 'text' : 'password'}
                                    value={newPin}
                                    onChange={e => setNewPin(e.target.value.replace(/[^0-9]/g, ''))}
                                    placeholder="Enter new PIN"
                                    maxLength={6}
                                    className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-gray-900 outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNewPin(!showNewPin)}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                                >
                                    {showNewPin ? <EyeOffIcon /> : <EyeIcon />}
                                </button>
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1">Choose a new 6-digit PIN (you must also enter your current PIN above). Changes take effect on next login.</p>
                        </div>

                        <div className="md:col-start-2">
                            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Confirm PIN</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                                </div>
                                <input
                                    type="password"
                                    value={confirmPin}
                                    onChange={e => setConfirmPin(e.target.value.replace(/[^0-9]/g, ''))}
                                    placeholder="Confirm new PIN"
                                    maxLength={6}
                                    className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border ${
                                        confirmPin
                                            ? newPin === confirmPin
                                                ? 'border-green-300 focus:ring-green-200'
                                                : 'border-red-300 focus:ring-red-200'
                                            : 'border-gray-200 focus:ring-gray-900'
                                    } rounded-xl text-sm font-bold text-gray-900 focus:ring-2 outline-none`}
                                />
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1">Re-type the new PIN for verification.</p>
                        </div>

                    </div>

                        <div className="pt-6 flex justify-end">
                            <button 
                                onClick={handleSave}
                                disabled={!isModified}
                                className={`px-6 py-3 rounded-xl font-bold uppercase tracking-widest text-xs text-white shadow-lg flex items-center gap-2 transition-all transform ${isModified ? 'hover:opacity-90 hover:-translate-y-0.5 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                                style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Profile;
