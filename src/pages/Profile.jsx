import React, { useState, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { showToast } from '../utils/toastHelper';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { meApi, updateMyProfileApi, verifyCurrentPasswordApi, verifyCurrentPinApi } from '../services/authApi';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
const normalizePhoneDigits = (value) => (value || '').replace(/\D/g, '').slice(0, 11);

const normalizeProfileSnapshot = (data) => ({
    adminUser: (data.adminUser || '').trim(),
    fullName: (data.fullName || '').trim(),
    adminDisplayName: (data.adminDisplayName || '').trim(),
    email: (data.email || '').trim().toLowerCase(),
    contactNumber: normalizePhoneDigits(data.contactNumber),
    avatar: data.avatar || null,
});

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

const FieldLockTooltip = ({ show, message }) => {
    if (!show) {
        return null;
    }

    return (
        <div className="pointer-events-none absolute -top-11 left-0 z-30 hidden w-max max-w-[280px] group-hover:block group-focus-within:block">
            <div className="rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-semibold text-white shadow-xl ring-1 ring-black/10">
                {message}
            </div>
            <span className="absolute -bottom-1 left-4 h-2 w-2 rotate-45 bg-gray-900" />
        </div>
    );
};

const Profile = () => {
    const { appSettings: settings, updateSettings, userRole, ROLES, roleNames } = useAuth();
    const { renameUserReferences } = useInventory();

    // Internal handler to replace onSave prop
    const handleSaveInternal = (newSettings) => {
        // Keep downstream logs and labels consistent when display name changes.
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
                data.fullName = data.fullName || data.adminDisplayName || '';
                data.contactNumber = data.contactNumber || settings.adminContactNumber || '';
                data.lastLogin = data.lastLogin || null;
                return data;
            }
            return {
                adminUser: 'cashier',
                fullName: 'Cashier Account',
                adminDisplayName: 'Cashier Account',
                adminPassword: '',
                role: 'Cashier',
                email: 'cashier@tableria.com',
                contactNumber: settings.adminContactNumber || '',
                lastLogin: null,
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
                fullName: me.fullName || me.name || '',
                adminDisplayName: settings.adminDisplayName || me.name || '',
                adminPassword: '',
                role: roleNames[userRole] || 'Admin',
                email: me.email || '',
                contactNumber: settings.adminContactNumber || me.phone || '',
                lastLogin: me.lastLogin || null,
                bio: me.bio || '',
                avatar: me.avatar || null,
                pin: me.pin || ''
            };
        }
        // super admin default from settings
        return {
            adminUser: settings.adminUser || 'Admin User',
            fullName: settings.adminFullName || settings.adminDisplayName || settings.adminUser || 'Admin User',
            adminDisplayName: settings.adminDisplayName || settings.adminUser || 'Admin User',
            adminPassword: '',
            role: roleNames[userRole] || 'Super Admin',
            email: settings.storePrimaryEmail || 'admin@example.com',
            contactNumber: settings.adminContactNumber || '',
            lastLogin: null,
            bio: 'Managing the store inventory and sales.',
            avatar: settings.avatar || null
        };
    });
    const [baselineProfile, setBaselineProfile] = useState(() => normalizeProfileSnapshot(profileData));

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
    const [backendUsername, setBackendUsername] = useState(() => sessionStorage.getItem('authUsername') || null);
    const [passwordVerifyState, setPasswordVerifyState] = useState('idle');
    const [pinVerifyState, setPinVerifyState] = useState('idle');
    const passwordVerifyTimerRef = useRef(null);
    const pinVerifyTimerRef = useRef(null);
    const [activeSection, setActiveSection] = useState('personal');

    const profileSections = [
        { id: 'personal', label: 'Personal Details' },
        { id: 'security', label: 'Security & Login' },
        { id: 'pin', label: 'Change Security PIN' },
    ];

    React.useEffect(() => {
        let isMounted = true;

        const hydrateProfileFromBackend = async () => {
            if (userRole === ROLES.CASHIER) {
                return;
            }

            try {
                const response = await meApi();
                const user = response?.user;

                if (!isMounted || !user) {
                    return;
                }

                setBackendUsername(user.username || null);
                if (user.username) {
                    sessionStorage.setItem('authUsername', user.username);
                }

                setProfileData((prev) => {
                    const hydratedProfile = {
                        ...prev,
                        adminUser: user.username || prev.adminUser,
                        fullName: user.name || prev.fullName,
                        adminDisplayName: prev.adminDisplayName || settings.adminDisplayName || user.name || prev.fullName,
                        email: user.email || prev.email,
                        role: roleNames[user.role] || prev.role,
                        contactNumber: prev.contactNumber || settings.adminContactNumber || '',
                        lastLogin: user.lastLogin || prev.lastLogin || null,
                    };

                    setBaselineProfile(normalizeProfileSnapshot(hydratedProfile));
                    return hydratedProfile;
                });
            } catch {
                // Keep existing local fallback values when backend profile fetch fails.
            }
        };

        hydrateProfileFromBackend();

        return () => {
            isMounted = false;
        };
    }, [userRole, ROLES.CASHIER, roleNames, settings.adminContactNumber, settings.adminDisplayName]);

    const formatLastLogin = (value) => {
        if (!value) {
            return 'No recent login recorded';
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return 'No recent login recorded';
        }

        return parsed.toLocaleString();
    };

    const isPasswordChangeAttempt = Boolean(profileData.adminPassword || confirmPassword);
    const isPinChangeAttempt = Boolean(newPin || confirmPin);
    const validCurrentPin = !isPinChangeAttempt || pinVerifyState === 'valid';
    const validCurrentPassword = !isPasswordChangeAttempt || passwordVerifyState === 'valid';
    const canEnterNewPassword = passwordVerifyState === 'valid';
    const canEnterNewPin = pinVerifyState === 'valid';
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
        if (!profileData.adminUser || !profileData.fullName || !profileData.adminDisplayName || !profileData.email) {
            return false;
        }

        const currentProfile = normalizeProfileSnapshot(profileData);
        if (currentProfile.contactNumber && currentProfile.contactNumber.length !== 11) {
            return false;
        }

        const hasCoreProfileChanges =
            !baselineProfile ||
            currentProfile.adminUser !== baselineProfile.adminUser ||
            currentProfile.fullName !== baselineProfile.fullName ||
            currentProfile.adminDisplayName !== baselineProfile.adminDisplayName ||
            currentProfile.email !== baselineProfile.email ||
            currentProfile.contactNumber !== baselineProfile.contactNumber ||
            currentProfile.avatar !== baselineProfile.avatar;

        const hasPasswordChanges = Boolean(profileData.adminPassword || confirmPassword);
        const hasPinChanges = Boolean(newPin || confirmPin);

        if (profileData.adminPassword) {
            if (!currentPassword || !confirmPassword) {
                return false;
            }

            if (profileData.adminPassword !== confirmPassword || !allPasswordChecksMet) {
                return false;
            }
        }

        if (newPin) {
            if (!oldPin || newPin !== confirmPin || newPin.length !== 6 || oldPin.length !== 6) {
                return false;
            }
        }

        return hasCoreProfileChanges || hasPasswordChanges || hasPinChanges;
    }, [profileData, baselineProfile, currentPassword, confirmPassword, oldPin, newPin, confirmPin, allPasswordChecksMet]);

    const verifyCurrentPassword = async () => {
        if (!currentPassword) {
            setPasswordVerifyState('idle');
            return;
        }

        setPasswordVerifyState('checking');
        try {
            const response = await verifyCurrentPasswordApi(currentPassword);
            setPasswordVerifyState(response?.valid ? 'valid' : 'invalid');
        } catch {
            setPasswordVerifyState('invalid');
        }
    };

    const verifyCurrentPin = async () => {
        if (!oldPin) {
            setPinVerifyState('idle');
            return;
        }

        setPinVerifyState('checking');
        try {
            const response = await verifyCurrentPinApi(oldPin);
            setPinVerifyState(response?.valid ? 'valid' : 'invalid');
        } catch {
            setPinVerifyState('invalid');
        }
    };

    const handleCurrentPasswordBlur = async () => {
        if (!currentPassword) {
            return;
        }

        if (passwordVerifyTimerRef.current) {
            clearTimeout(passwordVerifyTimerRef.current);
            passwordVerifyTimerRef.current = null;
        }

        await verifyCurrentPassword();
    };

    const handleCurrentPinBlur = async () => {
        if (!oldPin) {
            return;
        }

        if (pinVerifyTimerRef.current) {
            clearTimeout(pinVerifyTimerRef.current);
            pinVerifyTimerRef.current = null;
        }

        await verifyCurrentPin();
    };

    React.useEffect(() => {
        if (!currentPassword) {
            setPasswordVerifyState('idle');
            if (passwordVerifyTimerRef.current) {
                clearTimeout(passwordVerifyTimerRef.current);
                passwordVerifyTimerRef.current = null;
            }
            return;
        }

        if (passwordVerifyTimerRef.current) {
            clearTimeout(passwordVerifyTimerRef.current);
        }

        passwordVerifyTimerRef.current = setTimeout(() => {
            verifyCurrentPassword();
        }, 450);

        return () => {
            if (passwordVerifyTimerRef.current) {
                clearTimeout(passwordVerifyTimerRef.current);
                passwordVerifyTimerRef.current = null;
            }
        };
    }, [currentPassword]);

    React.useEffect(() => {
        if (!oldPin) {
            setPinVerifyState('idle');
            if (pinVerifyTimerRef.current) {
                clearTimeout(pinVerifyTimerRef.current);
                pinVerifyTimerRef.current = null;
            }
            return;
        }

        if (oldPin.length < 6) {
            setPinVerifyState('idle');
            if (pinVerifyTimerRef.current) {
                clearTimeout(pinVerifyTimerRef.current);
                pinVerifyTimerRef.current = null;
            }
            return;
        }

        if (pinVerifyTimerRef.current) {
            clearTimeout(pinVerifyTimerRef.current);
        }

        pinVerifyTimerRef.current = setTimeout(() => {
            verifyCurrentPin();
        }, 450);

        return () => {
            if (pinVerifyTimerRef.current) {
                clearTimeout(pinVerifyTimerRef.current);
                pinVerifyTimerRef.current = null;
            }
        };
    }, [oldPin]);

    const handleSave = async () => {
        const normalizedEmail = (profileData.email || '').trim().toLowerCase();
        const nextDisplayName = (profileData.adminDisplayName || '').trim();
        const previousDisplayName = avatarName;
        const previousUsername = backendUsername || sessionStorage.getItem('authUsername') || profileData.adminUser;
        const normalizedContactNumber = normalizePhoneDigits(profileData.contactNumber);

        if (!(profileData.fullName || '').trim()) {
            showToast('Error', 'Full name is required.', 'error');
            return;
        }

        if (!nextDisplayName) {
            showToast('Error', 'Display name is required.', 'error');
            return;
        }

        if (!normalizedEmail) {
            showToast('Error', 'Email is required.', 'error');
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            showToast('Error', 'Enter a valid email address.', 'error');
            return;
        }

        if (normalizedContactNumber && normalizedContactNumber.length !== 11) {
            showToast('Error', 'Contact number must be exactly 11 digits.', 'error');
            return;
        }

        if (profileData.adminPassword) {
            if (!currentPassword) {
                showToast('Error', 'Current password is required.', 'error');
                return;
            }

            if (passwordVerifyState !== 'valid') {
                showToast('Error', 'Current password is incorrect.', 'error');
                return;
            }

            if (profileData.adminPassword !== confirmPassword) {
                showToast('Error', 'Passwords do not match.', 'error');
                return;
            }

            if (!PASSWORD_RULE.test(profileData.adminPassword)) {
                showToast('Weak Password', 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.', 'error');
                return;
            }
        }

        if (newPin) {
            if (!oldPin || oldPin.length !== 6) {
                showToast('Error', 'Current PIN is required.', 'error');
                return;
            }

            if (pinVerifyState !== 'valid') {
                showToast('Error', 'Current PIN is incorrect.', 'error');
                return;
            }

            if (newPin.length !== 6) {
                showToast('Error', 'PIN must be exactly 6 digits.', 'error');
                return;
            }

            if (newPin !== confirmPin) {
                showToast('Error', 'New PIN entries do not match.', 'error');
                return;
            }
        }

        let response;
        try {
            response = await updateMyProfileApi({
                name: profileData.fullName.trim(),
                username: profileData.adminUser,
                email: normalizedEmail,
                ...(profileData.adminPassword ? { currentPassword, newPassword: profileData.adminPassword } : {}),
                ...(newPin ? { currentPin: oldPin, newPin } : {}),
            });
        } catch (error) {
            showToast('Error', error.message || 'Unable to update profile details.', 'error');
            return;
        }

        const updatedUser = response?.user;
        if (!updatedUser) {
            showToast('Error', 'Profile update response is invalid.', 'error');
            return;
        }

        sessionStorage.setItem('userName', nextDisplayName);
        sessionStorage.setItem('authUsername', updatedUser.username);
        setBackendUsername(updatedUser.username);

        if (previousDisplayName !== nextDisplayName) {
            renameUserReferences(previousDisplayName, nextDisplayName);
        }

        // Keep legacy local list aligned until UserList is fully backend-driven.
        try {
            const users = JSON.parse(localStorage.getItem('users') || '[]');
            if (Array.isArray(users) && users.length > 0) {
                const synced = users.map((u) => {
                    if (u.username === previousUsername || u.name === previousDisplayName) {
                        return {
                            ...u,
                            username: updatedUser.username,
                            name: nextDisplayName,
                            email: updatedUser.email,
                            phone: normalizedContactNumber || u.phone || '',
                            avatar: profileData.avatar,
                        };
                    }
                    return u;
                });
                localStorage.setItem('users', JSON.stringify(synced));
            }
        } catch {
            // Ignore local storage sync issues.
        }

        handleSaveInternal({
            ...settings,
            adminUser: updatedUser.username,
            adminFullName: updatedUser.name,
            adminDisplayName: nextDisplayName,
            adminContactNumber: normalizedContactNumber,
            storePrimaryEmail: updatedUser.email,
            avatar: profileData.avatar,
            autoPrintReceipts: autoPrint,
        });

        const savedProfile = {
            ...profileData,
            adminUser: updatedUser.username,
            fullName: updatedUser.name,
            adminDisplayName: nextDisplayName,
            email: updatedUser.email,
            contactNumber: normalizedContactNumber,
            lastLogin: updatedUser.lastLogin || profileData.lastLogin || null,
            adminPassword: '',
        };

        setBaselineProfile(normalizeProfileSnapshot(savedProfile));

        setProfileData(savedProfile);

        setAvatarName(nextDisplayName);
        originalUsernameRef.current = updatedUser.username;
        setCurrentPassword('');
        setConfirmPassword('');
        setPasswordVerifyState('idle');
        setOldPin('');
        setPinVerifyState('idle');
        setNewPin('');
        setConfirmPin('');

        showToast('Success', newPin ? 'Profile and PIN updated successfully.' : 'Profile updated successfully.', 'save', 'profile-save');
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
        <div className="h-full min-h-0 w-full bg-slate-200/50 overflow-hidden">
            <div className="h-full min-h-0 w-full max-w-[1180px] mx-auto flex flex-col p-2 md:p-3 overflow-hidden relative text-[12px] md:text-[13px]">
            
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
            <div className="mb-4 flex items-center gap-3">
                <div className="bg-gray-900 text-white p-3 rounded-2xl shadow-lg hidden sm:block">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                </div>
                <div>
                    <h1 className="text-xl md:text-2xl font-black text-gray-900 leading-tight">My Profile</h1>
                    <p className="text-gray-500 text-xs md:text-sm font-medium mt-1">Manage your personal information and security.</p>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
                
                {/* Left Column: Avatar Card */}
                <div className="w-full md:w-1/3 flex flex-col gap-3">
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col items-center text-center">
                        <div className="relative group">
                            <div className={`w-28 h-28 md:w-32 md:h-32 rounded-full bg-gray-100 border-4 border-white shadow-lg overflow-hidden mb-3 relative cursor-pointer`}>
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
                        
                        <h2 className="text-base md:text-lg font-bold text-gray-900">{avatarName}</h2>
                        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full mt-2">
                            {profileData.role || (roleNames[userRole] || (userRole === ROLES.CASHIER ? 'Staff' : 'Super Admin'))}
                        </span>
                    </div>

                    {/* Desktop Section Navigation */}
                    <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 p-3">
                        <p className="px-2 pb-2 text-[10px] font-bold tracking-widest text-gray-500 uppercase">Profile Sections</p>
                        <div className="space-y-1">
                            {profileSections.map((section) => {
                                const isActive = activeSection === section.id;
                                return (
                                    <button
                                        key={section.id}
                                        type="button"
                                        onClick={() => setActiveSection(section.id)}
                                        className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                                            isActive
                                                ? 'bg-gray-900 text-white shadow-md'
                                                : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                    >
                                        {section.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right Column: Edit Form */}
                <div className="w-full md:w-2/3 h-full min-h-0">
                    <div className="profile-form-card bg-white rounded-2xl shadow-sm border border-gray-100 p-4 md:p-5 space-y-4 overflow-hidden">
                        {/* Mobile Section Navigation */}
                        <div className="md:hidden pb-1">
                            <div className="flex flex-wrap gap-1.5">
                                {profileSections.map((section) => {
                                    const isActive = activeSection === section.id;
                                    return (
                                        <button
                                            key={section.id}
                                            type="button"
                                            onClick={() => setActiveSection(section.id)}
                                            className={`px-2.5 py-1.5 rounded-xl text-[10px] font-bold whitespace-nowrap transition-all ${
                                                isActive
                                                    ? 'bg-gray-900 text-white shadow-md'
                                                    : 'bg-gray-100 text-gray-600'
                                            }`}
                                        >
                                            {section.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {activeSection === 'personal' && (
                            <div className="overflow-y-auto no-scrollbar pr-1 pb-2 max-h-[calc(100vh-340px)] md:max-h-[calc(100vh-300px)]">
                                <div className="border-b border-gray-100 pb-4 mb-4">
                                    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.121 17.804A13.937 13.937 0 0112 15c2.761 0 5.303.896 7.379 2.404M15 10a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                        Personal Details
                                    </h3>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Full Name</label>
                                        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-transparent transition-all">
                                            <div className="pl-3 pr-2 flex items-center pointer-events-none">
                                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                            </div>
                                            <input
                                                type="text"
                                                value={profileData.fullName || ''}
                                                onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                                                className="w-full pr-4 py-2.5 bg-transparent rounded-xl text-sm text-gray-900 focus:ring-0 focus:outline-none border-0"
                                            />
                                        </div>
                                        <p className="text-[10px] text-gray-500 mt-1">Your official account name.</p>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Display Name</label>
                                        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-transparent transition-all">
                                            <div className="pl-3 pr-2 flex items-center pointer-events-none">
                                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 11c1.657 0 3-1.343 3-3S13.657 5 12 5s-3 1.343-3 3 1.343 3 3 3zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"></path></svg>
                                            </div>
                                            <input
                                                type="text"
                                                value={profileData.adminDisplayName || ''}
                                                onChange={(e) => setProfileData({ ...profileData, adminDisplayName: e.target.value })}
                                                className="w-full pr-4 py-2.5 bg-transparent rounded-xl text-sm text-gray-900 focus:ring-0 focus:outline-none border-0"
                                            />
                                        </div>
                                        <p className="text-[10px] text-gray-500 mt-1">Name shown across the app and activity logs.</p>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Email Address</label>
                                        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-transparent transition-all">
                                            <div className="pl-3 pr-2 flex items-center pointer-events-none">
                                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                                            </div>
                                            <input
                                                type="text"
                                                value={profileData.email}
                                                onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                                                className="w-full pr-4 py-2.5 bg-transparent rounded-xl text-sm text-gray-900 focus:ring-0 focus:outline-none border-0"
                                            />
                                        </div>
                                        <p className="text-[10px] text-gray-500 mt-1">Primary contact email for account notifications.</p>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Contact Number</label>
                                        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-transparent transition-all">
                                            <div className="pl-3 pr-2 flex items-center pointer-events-none">
                                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h2.28a2 2 0 011.894 1.368l.69 2.071a2 2 0 01-.457 2.043l-1.35 1.35a16 16 0 006.586 6.586l1.35-1.35a2 2 0 012.043-.457l2.071.69A2 2 0 0121 18.72V21a2 2 0 01-2 2h-1C9.716 23 1 14.284 1 4V3a2 2 0 012-2z"></path></svg>
                                            </div>
                                            <input
                                                type="tel"
                                                inputMode="numeric"
                                                pattern="[0-9]{11}"
                                                value={profileData.contactNumber || ''}
                                                onChange={(e) => setProfileData({ ...profileData, contactNumber: normalizePhoneDigits(e.target.value) })}
                                                className="w-full pr-4 py-2.5 bg-transparent rounded-xl text-sm text-gray-900 focus:ring-0 focus:outline-none border-0"
                                                placeholder="e.g. 09171234567"
                                            />
                                        </div>
                                        <p className="text-[10px] text-gray-500 mt-1">Use a professional 11-digit mobile number for account contact.</p>
                                        {profileData.contactNumber && normalizePhoneDigits(profileData.contactNumber).length !== 11 && (
                                            <p className="text-[10px] text-rose-500 mt-1">Contact number must be exactly 11 digits.</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Position</label>
                                        <input
                                            type="text"
                                            value={profileData.role || (roleNames[userRole] || 'Staff')}
                                            readOnly
                                            className="w-full px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-xl text-sm text-gray-700 outline-none"
                                        />
                                        <p className="text-[10px] text-gray-500 mt-1">Role is managed by the system administrator.</p>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Last Login</label>
                                        <input
                                            type="text"
                                            value={formatLastLogin(profileData.lastLogin)}
                                            readOnly
                                            className="w-full px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-xl text-sm text-gray-700 outline-none"
                                        />
                                        <p className="text-[10px] text-gray-500 mt-1">Latest successful sign-in for this account.</p>
                                    </div>
                                </div>

                                <div className="mt-4 border-t border-gray-100 pt-4">
                                    <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">Preferences</h4>
                                    <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-200">
                                        <div>
                                            <h5 className="text-sm font-bold text-gray-900">Automatic Printing</h5>
                                            <p className="text-xs text-gray-500 font-medium">Automatically print receipt after transaction completes</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleAutoPrintToggle}
                                            className={`w-11 h-6 rounded-full relative transition-colors ${!autoPrint ? 'bg-gray-200' : ''}`}
                                            style={{ backgroundColor: autoPrint ? '#111827' : '' }}
                                        >
                                            <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform ${autoPrint ? 'translate-x-5' : ''}`}></span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeSection === 'security' && (
                            <>
                                <div className="border-b border-gray-100 pb-4 mb-4">
                                    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
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
                                                onChange={(e) => setProfileData({ ...profileData, adminUser: e.target.value })}
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
                                                onChange={(e) => {
                                                    setCurrentPassword(e.target.value);
                                                    setPasswordVerifyState('idle');
                                                }}
                                                onBlur={handleCurrentPasswordBlur}
                                                placeholder="Enter current password"
                                                className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border rounded-xl text-sm text-gray-900 focus:ring-2 outline-none ${
                                                    passwordVerifyState === 'valid'
                                                        ? 'border-green-300 focus:ring-green-200'
                                                        : 'border-gray-200 focus:ring-gray-900'
                                                }`}
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
                                        {isPasswordChangeAttempt && !validCurrentPassword && (
                                            <p className="text-[10px] text-red-500 mt-1">Current password is required when changing password.</p>
                                        )}
                                        {passwordVerifyState === 'valid' && (
                                            <p className="text-[10px] text-green-600 mt-1">Current password verified.</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">New Password</label>
                                        <div className="relative group">
                                            <FieldLockTooltip
                                                show={!canEnterNewPassword}
                                                message="Verify current password first before entering a new password."
                                            />
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                                            </div>
                                            <input
                                                name="newPassword"
                                                autoComplete="new-password"
                                                type={showPassword ? 'text' : 'password'}
                                                value={profileData.adminPassword}
                                                onChange={(e) => setProfileData({ ...profileData, adminPassword: e.target.value })}
                                                disabled={!canEnterNewPassword}
                                                placeholder={canEnterNewPassword ? 'Enter new password' : 'Verify current password first'}
                                                className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border rounded-xl text-sm text-gray-900 focus:ring-2 outline-none ${
                                                    profileData.adminPassword
                                                        ? allPasswordChecksMet
                                                            ? 'border-green-300 focus:ring-green-200'
                                                            : 'border-red-300 focus:ring-red-200'
                                                        : 'border-gray-200 focus:ring-gray-900'
                                                } ${!canEnterNewPassword ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                                        <div className="relative group">
                                            <FieldLockTooltip
                                                show={!canEnterNewPassword}
                                                message="Verify current password first before confirming a new password."
                                            />
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                                            </div>
                                            <input
                                                name="confirmPassword"
                                                autoComplete="new-password"
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                disabled={!canEnterNewPassword}
                                                placeholder={canEnterNewPassword ? 'Confirm new password' : 'Verify current password first'}
                                                className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border ${
                                                    confirmPassword
                                                        ? profileData.adminPassword === confirmPassword
                                                            ? 'border-green-300 focus:ring-green-200'
                                                            : 'border-red-300 focus:ring-red-200'
                                                        : 'border-gray-200 focus:ring-gray-900'
                                                } rounded-xl text-sm text-gray-900 focus:ring-2 outline-none ${!canEnterNewPassword ? 'opacity-60 cursor-not-allowed' : ''}`}
                                            />
                                        </div>
                                        <p className="text-[10px] text-gray-500 mt-1">Re-type the new password exactly as above.</p>
                                    </div>
                                </div>
                            </>
                        )}

                        {activeSection === 'pin' && (
                            <>
                                <div className="border-b border-gray-100 pb-4 mb-4">
                                    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                        Change Security PIN
                                    </h3>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Current PIN</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                                </div>
                                <input
                                    type={showOldPin ? 'text' : 'password'}
                                    value={oldPin}
                                    onChange={e => {
                                        setOldPin(e.target.value.replace(/[^0-9]/g, ''));
                                        setPinVerifyState('idle');
                                    }}
                                    onBlur={handleCurrentPinBlur}
                                    placeholder="Enter current PIN"
                                    maxLength={6}
                                    className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border ${
                                        pinVerifyState === 'valid'
                                            ? 'border-green-300 focus:ring-green-200'
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
                            {isPinChangeAttempt && !validCurrentPin && (
                                <p className="text-[10px] text-red-500 mt-1">Current PIN is required when changing PIN.</p>
                            )}
                            {pinVerifyState === 'valid' && (
                                <p className="text-[10px] text-green-600 mt-1">Current PIN verified.</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">New PIN</label>
                            <div className="relative group">
                                <FieldLockTooltip
                                    show={!canEnterNewPin}
                                    message="Verify current PIN first before entering a new PIN."
                                />
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                                </div>
                                <input
                                    type={showNewPin ? 'text' : 'password'}
                                    value={newPin}
                                    onChange={e => setNewPin(e.target.value.replace(/[^0-9]/g, ''))}
                                    disabled={!canEnterNewPin}
                                    placeholder={canEnterNewPin ? 'Enter new PIN' : 'Verify current PIN first'}
                                    maxLength={6}
                                    className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-gray-900 outline-none ${!canEnterNewPin ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                            <div className="relative group">
                                <FieldLockTooltip
                                    show={!canEnterNewPin}
                                    message="Verify current PIN first before confirming a new PIN."
                                />
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                                </div>
                                <input
                                    type="password"
                                    value={confirmPin}
                                    onChange={e => setConfirmPin(e.target.value.replace(/[^0-9]/g, ''))}
                                    disabled={!canEnterNewPin}
                                    placeholder={canEnterNewPin ? 'Confirm new PIN' : 'Verify current PIN first'}
                                    maxLength={6}
                                    className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 border ${
                                        confirmPin
                                            ? newPin === confirmPin
                                                ? 'border-green-300 focus:ring-green-200'
                                                : 'border-red-300 focus:ring-red-200'
                                            : 'border-gray-200 focus:ring-gray-900'
                                    } rounded-xl text-sm font-bold text-gray-900 focus:ring-2 outline-none ${!canEnterNewPin ? 'opacity-60 cursor-not-allowed' : ''}`}
                                />
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1">Re-type the new PIN for verification.</p>
                        </div>

                    </div>
                    </>
                    )}

                        <div className="pt-1 flex justify-end">
                            <div className="relative group">
                                {!isModified && (
                                    <div className="pointer-events-none absolute -top-11 right-0 z-30 hidden w-max max-w-[260px] group-hover:block">
                                        <div className="rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-semibold text-white shadow-xl ring-1 ring-black/10">
                                            No pending updates. Make a profile change to enable saving.
                                        </div>
                                        <span className="absolute -bottom-1 right-6 h-2 w-2 rotate-45 bg-gray-900" />
                                    </div>
                                )}
                                <button 
                                    onClick={handleSave}
                                    disabled={!isModified}
                                    className={`px-4 md:px-5 py-2.5 rounded-xl font-bold uppercase tracking-wider text-[10px] md:text-xs text-white shadow-lg flex items-center gap-2 transition-all transform ${isModified ? 'hover:opacity-90 hover:-translate-y-0.5 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
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
            </div>
        </div>
    );
};

export default Profile;
