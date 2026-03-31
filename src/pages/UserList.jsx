import React, { useState } from 'react';
import { showToast } from '../utils/toastHelper';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { ROLES, roleNames } from '../constants/roles';
import { listUsersApi, registerApi, updateUserByUsernameApi } from '../services/authApi';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const mapUserToUi = (user, index) => ({
    id: index + 1,
    backendId: user.id,
    name: user.name || '',
    username: user.username || '',
    email: user.email || '',
    phone: user.phone || '',
    role: user.role || ROLES.CASHIER,
    status: user.isActive ? 'Active' : 'Inactive',
    isArchived: !user.isActive,
    lastLogin: user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never',
});

const getFieldErrorsFromMessage = (message = '') => {
    const lowerMessage = String(message).toLowerCase();
    const nextErrors = {};

    if (lowerMessage.includes('username or email already in use') || lowerMessage.includes('email already in use')) {
        nextErrors.email = 'Email is already in use by another account.';
    }

    if (lowerMessage.includes('valid email')) {
        nextErrors.email = nextErrors.email || 'Please enter a complete valid email address.';
    }

    if (lowerMessage.includes('phone number must be exactly 11 digits')) {
        nextErrors.phone = 'Phone number must be exactly 11 digits.';
    }

    if (lowerMessage.includes('pin must be exactly 6 digits')) {
        nextErrors.pin = 'PIN must be exactly 6 digits.';
    }

    if (lowerMessage.includes('password must be at least')) {
        nextErrors.password = 'Password must meet minimum security requirements.';
    }

    if (lowerMessage.includes('user not found')) {
        nextErrors.username = 'No backend account found for this user. Sync or recreate this account first.';
    }

    return nextErrors;
};

const UserList = () => {
    const { currentUserName } = useAuth();
    const { logActivity, renameUserReferences } = useInventory();

    const [users, setUsers] = useState([]);

    const loadUsers = async () => {
        try {
            const response = await listUsersApi();
            const list = Array.isArray(response) ? response : [];
            setUsers(list.map(mapUserToUi));
        } catch {
            setUsers([]);
        }
    };

    React.useEffect(() => {
        loadUsers();
    }, []);

    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState('add'); // 'add' or 'edit'
    const [selectedUser, setSelectedUser] = useState(null);
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [userToArchive, setUserToArchive] = useState(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;
    
    const initialFormState = { name: '', username: '', email: '', phone: '', role: ROLES.CASHIER, status: 'Active', password: '', pin: '' };
    const [formData, setFormData] = useState(initialFormState);
    const [fieldErrors, setFieldErrors] = useState({});
    const [newItemId, setNewItemId] = useState(null);
    const passwordChecks = {
        length: (formData.password || '').length >= 8,
        lowercase: /[a-z]/.test(formData.password || ''),
        uppercase: /[A-Z]/.test(formData.password || ''),
        number: /\d/.test(formData.password || ''),
        special: /[^A-Za-z\d]/.test(formData.password || ''),
    };
    const allPasswordChecksMet = Object.values(passwordChecks).every(Boolean);

    // Derived Data
    const filteredUsers = users.filter(user => 
        user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (user.username && user.username.toLowerCase().includes(searchTerm.toLowerCase())) ||
        user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (roleNames[user.role] || user.role).toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Pagination Logic
    const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const paginatedUsers = filteredUsers.slice(indexOfFirstItem, indexOfLastItem);

    // Reset page when search changes
    React.useEffect(() => { setCurrentPage(1); }, [searchTerm]);

    // Helper: Generate Random Password
    const generatePassword = () => {
        const lowers = 'abcdefghijklmnopqrstuvwxyz';
        const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const digits = '0123456789';
        const symbols = '!@#$%^&*';
        const all = `${lowers}${uppers}${digits}${symbols}`;

        const pick = (charset) => charset[Math.floor(Math.random() * charset.length)];

        const seeded = [pick(lowers), pick(uppers), pick(digits), pick(symbols)];
        while (seeded.length < 10) seeded.push(pick(all));

        for (let i = seeded.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [seeded[i], seeded[j]] = [seeded[j], seeded[i]];
        }

        return seeded.join('');
    };
    const generatePin = () => {
        let p = '';
        for (let i=0;i<6;i++) p += Math.floor(Math.random()*10);
        return p;
    };

    // Handlers
    const handleOpenAdd = () => {
        setModalMode('add');
        setFieldErrors({});
        const nextId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
        setNewItemId(nextId);
        
        // Auto-generate credentials
        const autoUsername = `USER-${String(nextId).padStart(6, '0')}`;
        const autoPassword = generatePassword();
        const autoPin = generatePin();
        
        setFormData({
            ...initialFormState,
            username: autoUsername,
            password: autoPassword,
            pin: autoPin
        });
        setIsModalOpen(true);
    };

    const handleOpenEdit = (user) => {
        setModalMode('edit');
        setFieldErrors({});
        setSelectedUser(user);
        setFormData({ 
            name: user.name, 
            username: user.username || '',
            email: user.email, 
            phone: user.phone || '',
            role: user.role, 
            status: user.status, 
            password: '' // Don't show existing password
        });
        setIsModalOpen(true);
    };

    const isFormModified = React.useMemo(() => {
        if (modalMode === 'add') return true;
        if (!selectedUser) return false;
        return (
            formData.name !== selectedUser.name ||
            formData.username !== (selectedUser.username || '') ||
            formData.email !== selectedUser.email ||
            formData.phone !== (selectedUser.phone || '') ||
            formData.role !== selectedUser.role ||
            formData.status !== selectedUser.status ||
            (formData.password && formData.password !== '') ||
            (formData.pin && formData.pin !== (selectedUser.pin || ''))
        );
    }, [formData, selectedUser, modalMode]);

    const handleSave = async (e) => {
        e.preventDefault();
        const normalizedEmail = (formData.email || '').trim().toLowerCase();
        const nextFieldErrors = {};
        setFieldErrors({});
        
        if (!formData.name || !formData.email || !formData.username) {
            if (!formData.name) nextFieldErrors.name = 'Full name is required.';
            if (!formData.username) nextFieldErrors.username = 'Username is required.';
            if (!formData.email) nextFieldErrors.email = 'Email address is required.';
            setFieldErrors(nextFieldErrors);
            showToast('Missing Information', 'Name, Username, and Email are required', 'error', 'user-validation');
            return;
        }

        if (!EMAIL_RULE.test(normalizedEmail)) {
            setFieldErrors({ email: 'Please enter a complete valid email address.' });
            showToast('Invalid Email', 'Please enter a complete valid email address (e.g. name@example.com).', 'error', 'user-validation');
            return;
        }

        if (formData.phone && formData.phone.length !== 11) {
            setFieldErrors({ phone: 'Phone number must be exactly 11 digits.' });
            showToast('Invalid Phone', 'Phone number must be exactly 11 digits.', 'error', 'user-validation');
            return;
        }
        if (formData.pin && formData.pin.length !== 6) {
            setFieldErrors({ pin: 'PIN must be exactly 6 digits.' });
            showToast('Invalid PIN', 'PIN must be exactly 6 digits.', 'error', 'user-validation');
            return;
        }

        if (formData.password && !PASSWORD_RULE.test(formData.password)) {
            setFieldErrors({ password: 'Password must meet minimum security requirements.' });
            showToast('Weak Password', 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.', 'error', 'user-validation');
            return;
        }

        if (modalMode === 'add') {
            try {
                const response = await registerApi({
                    name: formData.name,
                    username: formData.username,
                    email: normalizedEmail,
                    phone: formData.phone,
                    password: formData.password,
                    pin: formData.pin,
                    role: formData.role,
                });

                const createdUser = response?.user;
                if (createdUser?.username) {
                    await updateUserByUsernameApi(createdUser.username, {
                        role: formData.role,
                        isActive: formData.status === 'Active',
                        phone: formData.phone,
                    });
                }

                await loadUsers();
                logActivity(currentUserName, 'Created User', `Added new user: ${formData.name}`);
                showToast('User Created', `${formData.name} added to the system.`, 'success', 'user-action');
            } catch (error) {
                setFieldErrors(getFieldErrorsFromMessage(error.message));
                showToast('Create Failed', error.message || 'Unable to create user account.', 'error', 'user-validation');
                return;
            }
        } else {
            if (!isFormModified) return;

            try {
                await updateUserByUsernameApi(selectedUser.username, {
                    name: formData.name,
                    username: formData.username,
                    email: normalizedEmail,
                    phone: formData.phone,
                    role: formData.role,
                    isActive: formData.status === 'Active',
                    ...(formData.password ? { password: formData.password } : {}),
                    ...(formData.pin ? { pin: formData.pin } : {}),
                });
            } catch (error) {
                setFieldErrors(getFieldErrorsFromMessage(error.message));
                showToast('Update Failed', error.message || 'Unable to update user account.', 'error', 'user-validation');
                return;
            }

            if (selectedUser.name !== formData.name) {
                renameUserReferences(selectedUser.name, formData.name);
            }

            await loadUsers();
            logActivity(currentUserName, 'Updated User', `Updated user: ${formData.name}`);
            showToast('User Updated', `${formData.name}'s profile has been updated.`, 'success', 'user-action');
        }
        setIsModalOpen(false);
        setFieldErrors({});
    };

    const toggleArchive = (user) => {
        setUserToArchive(user);
        setIsArchiveModalOpen(true);
    };

    const confirmArchive = async () => {
        if (!userToArchive) return;
        
        const isRestoring = userToArchive.isArchived;

        try {
            await updateUserByUsernameApi(userToArchive.username, {
                isActive: isRestoring,
            });
            await loadUsers();
        } catch (error) {
            showToast('Update Failed', error.message || 'Unable to update user status.', 'error', 'user-archive-action');
            return;
        }

        logActivity(currentUserName, isRestoring ? 'Restored User' : 'Archived User', `${isRestoring ? 'Restored' : 'Archived'} user: ${userToArchive.name}`);
        showToast(
            isRestoring ? 'User Restored' : 'User Archived',
            isRestoring 
                ? `${userToArchive.name} is now active.` 
                : `${userToArchive.name} has been archived.`,
            'success',
            'user-archive-action'
        );
        
        setIsArchiveModalOpen(false);
        setUserToArchive(null);
    };

    return (
        <div className="h-auto md:h-[calc(100vh-80px)] flex flex-col gap-2 md:overflow-hidden p-2">

            {/* Unified User List Container */}
            <div className="flex-1 flex flex-col bg-slate-200/50 dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 border-t-8 border-t-[#111827] md:overflow-hidden">
                
                {/* Header Area */}
                <div className="relative z-20 p-4 sm:p-5 flex items-center justify-between md:shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="text-gray-900 dark:text-white hidden sm:block">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                        </div>
                        <div>
                            <h1 className="text-xl font-black text-gray-900 dark:text-white leading-tight">User Management</h1>
                            <p className="text-gray-500 dark:text-gray-400 text-xs font-medium mt-0.5">Manage system access and roles</p>
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col md:overflow-hidden transition-colors bg-transparent pt-3">
                    {/* Toolbar */}
                    <div className="px-5 pb-4 flex flex-col sm:flex-row justify-between items-center gap-4 bg-transparent">
                    <div className="relative w-full sm:w-64 group">
                        <input 
                            type="text" 
                            placeholder="Search users..." 
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-100 dark:border-gray-600 rounded-xl text-sm focus:bg-white dark:focus:bg-gray-600 focus:border-gray-900 dark:focus:border-gray-400 focus:ring-0 transition-all shadow-sm placeholder:text-gray-400 font-bold text-gray-800 dark:text-gray-200"
                        />
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 p-1 bg-white dark:bg-gray-600 rounded-lg shadow-sm border border-gray-100 dark:border-gray-500 group-focus-within:border-gray-900 group-focus-within:bg-gray-900 dark:group-focus-within:border-gray-400 dark:group-focus-within:bg-gray-400 transition-all duration-300">
                            <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 group-focus-within:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        </div>
                    </div>

                    <button 
                        onClick={handleOpenAdd}
                        className="w-full sm:w-auto px-4 py-2 rounded-lg text-white font-bold text-xs shadow-md flex items-center justify-center gap-2 transition-all hover:opacity-90 transform hover:-translate-y-0.5"
                        style={{ backgroundColor: '#111827' }}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
                        Add New User
                    </button>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto px-5 pb-5 custom-scrollbar">
                     <table className="w-full text-left border-separate border-spacing-0 min-w-[800px]">
                        <thead className="sticky top-0 z-20 shadow-sm">
                            <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                <th className="px-6 py-3 text-xs font-bold text-center border border-gray-700 pl-6">ID</th>
                                <th className="px-6 py-3 text-xs font-bold text-left border border-gray-700">Name</th>
                                <th className="px-6 py-3 text-xs font-bold text-left border border-gray-700">Contact Info</th>
                                <th className="px-6 py-3 text-xs font-bold text-center border border-gray-700">Role</th>
                                <th className="px-6 py-3 text-xs font-bold text-center border border-gray-700">Status</th>
                                <th className="px-6 py-3 text-xs font-bold text-center border border-gray-700">Last Login</th>
                                <th className="px-6 py-3 text-xs font-bold text-center border border-gray-700">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                            {filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan="7" className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
                                        No users found.
                                    </td>
                                </tr>
                            ) : (
                                paginatedUsers.map((user) => (
                                    <tr key={user.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group ${
                                        user.isArchived 
                                        ? 'bg-gray-50/50 dark:bg-gray-800' // Removed grayscale/opacity filter to fix tooltip clipping
                                        : ''
                                    }`}>
                                        <td className={`px-6 py-3 text-center font-mono text-xs border border-gray-200 dark:border-gray-700 ${user.isArchived ? 'text-gray-300 dark:text-gray-600' : 'text-gray-400'}`}>
                                            #{String(user.id).padStart(3, '0')}
                                        </td>
                                        <td className="px-6 py-3 border border-gray-200 dark:border-gray-700">
                                            <div className="flex items-center gap-3">
                                                <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs uppercase ${
                                                    user.isArchived 
                                                    ? 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500' 
                                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-600 dark:text-gray-300'
                                                }`}>
                                                    {user.name.charAt(0)}
                                                </div>
                                                <div className={`text-sm font-bold ${user.isArchived ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>
                                                    {user.name} <span className="text-[10px] font-normal text-gray-500 ml-1 no-underline">(@{user.username})</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 border border-gray-200 dark:border-gray-700">
                                            <div className="flex flex-col">
                                                <div className={`text-xs font-medium ${user.isArchived ? 'text-gray-300 dark:text-gray-600' : 'text-gray-700 dark:text-gray-300'}`}>
                                                    {user.email}
                                                </div>
                                                {user.phone && (
                                                    <div className={`text-[11px] ${user.isArchived ? 'text-gray-300 dark:text-gray-600' : 'text-gray-400 dark:text-gray-500'}`}>
                                                        {user.phone}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 text-center border border-gray-200 dark:border-gray-700">
                                            <span className={`px-2 py-1 rounded-md text-xs font-semibold ${
                                                user.role === ROLES.SUPER_ADMIN 
                                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' 
                                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                            }`}>
                                                {roleNames[user.role] || user.role}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-center border border-gray-200 dark:border-gray-700">
                                            <div className="flex items-center justify-center gap-1.5">
                                                <div className={`w-1.5 h-1.5 rounded-full ${user.status === 'Active' ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                                                <span className={`text-xs font-bold ${user.status === 'Active' ? 'text-green-600' : 'text-gray-500'}`}>
                                                    {user.status}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 text-center text-xs text-gray-500 border border-gray-200 dark:border-gray-700">
                                            {user.lastLogin}
                                        </td>
                                        <td className="px-6 py-3 text-center border border-gray-200 dark:border-gray-700">
                                            <div className="flex items-center justify-center gap-2">
                                                {user.role !== ROLES.SUPER_ADMIN && (
                                                    <>
                                                        <button 
                                                            onClick={() => handleOpenEdit(user)}
                                                            className="group/btn relative p-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/btn:block z-20 w-max pointer-events-none">
                                                                <span className="bg-gray-900 text-white text-xs rounded py-1 px-2 shadow-lg block">Edit</span>
                                                                <span className="w-2 h-2 bg-gray-900 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2 block"></span>
                                                            </span>
                                                        </button>
                                                        <button 
                                                            onClick={() => toggleArchive(user)}
                                                            className={`group/btn relative p-1.5 rounded-lg transition-colors ${
                                                                user.isArchived 
                                                                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40' 
                                                                : 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/40'
                                                            }`}
                                                        >
                                                            {user.isArchived ? (
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                                     ) : (
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
                                                     )}
                                                     <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/btn:block z-20 w-max pointer-events-none">
                                                        <span className="bg-gray-900 text-white text-xs rounded py-1 px-2 shadow-lg block">
                                                            {user.isArchived ? "Restore" : "Archive"}
                                                        </span>
                                                        <span className="w-2 h-2 bg-gray-900 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2 block"></span>
                                                    </span>
                                                </button>
                                                </>
                                            )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                     </table>
                </div>

                {/* Pagination Controls */}
                <div className="shrink-0 flex justify-between items-center px-5 py-3 border-t border-slate-300 dark:border-gray-700 bg-transparent">
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                            Showing <span className="font-bold text-gray-900 dark:text-white">{filteredUsers.length === 0 ? 0 : indexOfFirstItem + 1}</span> to <span className="font-bold text-gray-900 dark:text-white">{Math.min(indexOfLastItem, filteredUsers.length)}</span> of <span className="font-bold text-gray-900 dark:text-white">{filteredUsers.length}</span> results
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className={`p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 transition-all ${currentPage === 1 ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                            </button>
                            {(() => {
                                const maxVisible = 5;
                                let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                                let end = start + maxVisible - 1;
                                if (end > totalPages) { end = totalPages; start = Math.max(1, end - maxVisible + 1); }
                                const pages = [];
                                if (start > 1) pages.push(<button key="first" onClick={() => setCurrentPage(1)} className="w-7 h-7 rounded-lg text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">1</button>);
                                if (start > 2) pages.push(<span key="dots-start" className="text-gray-400 text-xs px-0.5">...</span>);
                                for (let i = start; i <= end; i++) {
                                    pages.push(
                                        <button key={i} onClick={() => setCurrentPage(i)}
                                            className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                                                currentPage === i
                                                ? 'bg-gray-900 dark:bg-gray-600 text-white shadow-sm'
                                                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                        >{i}</button>
                                    );
                                }
                                if (end < totalPages - 1) pages.push(<span key="dots-end" className="text-gray-400 text-xs px-0.5">...</span>);
                                if (end < totalPages) pages.push(<button key="last" onClick={() => setCurrentPage(totalPages)} className="w-7 h-7 rounded-lg text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">{totalPages}</button>);
                                return pages;
                            })()}
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage === totalPages}
                                className={`p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 transition-all ${currentPage === totalPages ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                            </button>
                        </div>
                </div>
            </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm md:max-w-md max-h-[88vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col">
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-2">
                                <div className="text-gray-900 dark:text-white">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                                </div>
                                <div>
                                    <h3 className="font-black text-sm text-gray-900 dark:text-white leading-tight">
                                        {modalMode === 'add' ? 'Add New User' : 'Edit User'}
                                    </h3>
                                    <p className="text-gray-500 dark:text-gray-400 text-[10px] mt-0.5">
                                        {modalMode === 'add' ? 'Create a new account for system access.' : 'Update account details and permissions.'}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="px-4 py-3 space-y-3 overflow-y-auto">
                            {/* Row 1: ID and Name */}
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                <div className="col-span-1">
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 tracking-wider mb-1">User ID</label>
                                    <input 
                                        type="text" 
                                        disabled
                                        value={modalMode === 'add' ? `#${String(newItemId).padStart(3, '0')}` : `#${String(selectedUser?.id).padStart(3, '0')}`}
                                        className="w-full p-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-black text-gray-500 text-center cursor-not-allowed"
                                    />
                                </div>
                                <div className="col-span-3">
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 tracking-wider mb-1">Full Name</label>
                                    <input 
                                        type="text" 
                                        required
                                        value={formData.name}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (/^[a-zA-Z\s.-]*$/.test(val)) {
                                                setFieldErrors(prev => ({ ...prev, name: '' }));
                                                setFormData({...formData, name: val});
                                            }
                                        }}
                                        className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                        placeholder="John Doe"
                                    />
                                    <p className="text-[10px] text-gray-400 mt-1">Use letters, spaces, periods, or hyphens.</p>
                                    {fieldErrors.name && <p className="text-rose-500 text-[11px] mt-1">{fieldErrors.name}</p>}
                                </div>
                            </div>
                            
                            {/* Row 2: Role and Status */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 tracking-wider mb-1">Role</label>
                                    <select 
                                        value={formData.role}
                                        onChange={e => setFormData({...formData, role: e.target.value})}
                                        className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                    >
                                        {/* only allow Admin or Cashier; Super Admin is managed separately */}
                                        <option value={ROLES.ADMIN}>{roleNames[ROLES.ADMIN]}</option>
                                        <option value={ROLES.CASHIER}>{roleNames[ROLES.CASHIER]}</option>
                                    </select>
                                    <p className="text-[10px] text-gray-400 mt-1">Assign either administrator or cashier privileges.</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 tracking-wider mb-1">Status</label>
                                    <select 
                                        value={formData.status}
                                        onChange={e => setFormData({...formData, status: e.target.value})}
                                        className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                    >
                                        <option>Active</option>
                                        <option>Inactive</option>
                                    </select>
                                    <p className="text-[10px] text-gray-400 mt-1">Inactive users are blocked from logging in.</p>
                                </div>
                            </div>

                            {/* Row 3: Contact Info */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400  tracking-wider mb-1">Email Address</label>
                                    <input 
                                        type="email" 
                                        required
                                        value={formData.email}
                                        onChange={e => {
                                            setFieldErrors(prev => ({ ...prev, email: '' }));
                                            setFormData({...formData, email: e.target.value});
                                        }}
                                        className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                        placeholder="user@example.com"
                                    />
                                    <p className="text-[10px] text-gray-400 mt-1">Used for login and notifications; must be a complete valid email address.</p>
                                    {fieldErrors.email && <p className="text-rose-500 text-[11px] mt-1">{fieldErrors.email}</p>}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400  tracking-wider mb-1">Phone Number</label>
                                    <input 
                                        type="text" 
                                        value={formData.phone}
                                        onChange={e => {
                                            // Allow only digits, limit to 11
                                            const digits = e.target.value.replace(/\D/g, '');
                                            if (digits.length <= 11) {
                                                setFieldErrors(prev => ({ ...prev, phone: '' }));
                                                setFormData({...formData, phone: digits});
                                            }
                                        }}
                                        className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white" required
                                        placeholder="09171234567"
                                    />
                                    <p className="text-[10px] text-gray-400 mt-1">Optional; enter 11 digits (e.g. 09171234567).</p>
                                    {formData.phone && formData.phone.length !== 11 && (
                                        <p className="text-rose-500 text-[11px] mt-1">Phone number must be exactly 11 digits.</p>
                                    )}
                                    {fieldErrors.phone && <p className="text-rose-500 text-[11px] mt-1">{fieldErrors.phone}</p>}
                                </div>
                            </div>

                            {/* Row 4: Credentials */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400  tracking-wider mb-1">Username</label>
                                    <input 
                                        type="text" 
                                        disabled={modalMode === 'add'} // Read-only for new users
                                        value={formData.username}
                                        onChange={e => {
                                            const val = e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '');
                                            setFieldErrors(prev => ({ ...prev, username: '' }));
                                            setFormData({...formData, username: val});
                                        }}
                                        className={`w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white ${modalMode === 'add' ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-white dark:bg-gray-700'}`}
                                        placeholder="username123"
                                    />
                                    {modalMode === 'add' && <p className="text-[10px] text-gray-400 mt-1">Auto-generated based on ID</p>}
                                    {modalMode === 'edit' && <p className="text-[10px] text-gray-400 mt-1">Alphanumeric, underscores and dots allowed. Cannot be changed for new users.</p>}
                                    {fieldErrors.username && <p className="text-rose-500 text-[11px] mt-1">{fieldErrors.username}</p>}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400  tracking-wider mb-1">
                                        Password
                                    </label>
                                    <div className="relative">
                                        <input 
                                            type={modalMode === 'add' ? "text" : "password"} // Show text for auto-gen password
                                            disabled={modalMode === 'add'}
                                            value={formData.password}
                                            onChange={e => {
                                                setFieldErrors(prev => ({ ...prev, password: '' }));
                                                setFormData({...formData, password: e.target.value});
                                            }}
                                            className={`w-full p-2 border rounded-lg text-xs font-medium focus:ring-2 outline-none text-gray-900 dark:text-white ${modalMode === 'add' ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed font-mono' : 'bg-white dark:bg-gray-700'} ${
                                                formData.password
                                                    ? allPasswordChecksMet
                                                        ? 'border-green-300 dark:border-green-500 focus:ring-green-200 dark:focus:ring-green-600'
                                                        : 'border-red-300 dark:border-red-500 focus:ring-red-200 dark:focus:ring-red-600'
                                                    : 'border-gray-200 dark:border-gray-600 focus:ring-gray-900 dark:focus:ring-gray-500'
                                            }`}
                                            placeholder="••••••••"
                                        />
                                        {modalMode === 'add' && (
                                            <button 
                                                type="button"
                                                onClick={() => {
                                                    const newPass = generatePassword();
                                                    setFormData({...formData, password: newPass});
                                                }}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                                title="Regenerate Password"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                            </button>
                                        )}
                                    </div>
                                    {modalMode === 'add' && <p className="text-[10px] text-gray-400 mt-1">Auto-generated secure password</p>}
                                    {modalMode === 'edit' && <p className="text-[10px] text-gray-400 mt-1">Leave blank to keep existing password.</p>}
                                    {fieldErrors.password && <p className="text-rose-500 text-[11px] mt-1">{fieldErrors.password}</p>}
                                    {modalMode === 'edit' && formData.password && (
                                        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 p-2">
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-1.5">Password Requirements</p>
                                            <div className="grid grid-cols-1 gap-1">
                                                <div className={`text-[10px] flex items-center gap-1.5 ${passwordChecks.length ? 'text-green-700 dark:text-green-400' : 'text-gray-500'}`}>
                                                    <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${passwordChecks.length ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{passwordChecks.length ? '✓' : '•'}</span>
                                                    At least 8 characters
                                                </div>
                                                <div className={`text-[10px] flex items-center gap-1.5 ${passwordChecks.lowercase ? 'text-green-700 dark:text-green-400' : 'text-gray-500'}`}>
                                                    <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${passwordChecks.lowercase ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{passwordChecks.lowercase ? '✓' : '•'}</span>
                                                    Has lowercase letter
                                                </div>
                                                <div className={`text-[10px] flex items-center gap-1.5 ${passwordChecks.uppercase ? 'text-green-700 dark:text-green-400' : 'text-gray-500'}`}>
                                                    <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${passwordChecks.uppercase ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{passwordChecks.uppercase ? '✓' : '•'}</span>
                                                    Has uppercase letter
                                                </div>
                                                <div className={`text-[10px] flex items-center gap-1.5 ${passwordChecks.number ? 'text-green-700 dark:text-green-400' : 'text-gray-500'}`}>
                                                    <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${passwordChecks.number ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{passwordChecks.number ? '✓' : '•'}</span>
                                                    Has number
                                                </div>
                                                <div className={`text-[10px] flex items-center gap-1.5 ${passwordChecks.special ? 'text-green-700 dark:text-green-400' : 'text-gray-500'}`}>
                                                    <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${passwordChecks.special ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{passwordChecks.special ? '✓' : '•'}</span>
                                                    Has special character
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Row 5: PIN */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400  tracking-wider mb-1">
                                        PIN
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="123456"
                                        value={formData.pin}
                                        maxLength={6}
                                        onChange={e => {
                                            const digits = e.target.value.replace(/\D/g, '');
                                            if (digits.length <= 6) {
                                                setFieldErrors(prev => ({ ...prev, pin: '' }));
                                                setFormData({...formData, pin: digits});
                                            }
                                        }}
                                        className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                    />
                                    {modalMode === 'add' && <p className="text-[10px] text-gray-400 mt-1">Auto-generated 6‑digit PIN</p>}
                                    {modalMode === 'edit' && <p className="text-[10px] text-gray-400 mt-1">Leave blank to retain current PIN or enter a new 6‑digit code.</p>}
                                    {fieldErrors.pin && <p className="text-rose-500 text-[11px] mt-1">{fieldErrors.pin}</p>}
                                </div>
                            </div>

                            <button 
                                type="submit"
                                disabled={!isFormModified}
                                style={{ backgroundColor: isFormModified ? '#111827' : '#9ca3af', cursor: isFormModified ? 'pointer' : 'not-allowed' }}
                                className={`w-full py-2 text-white rounded-lg font-bold uppercase tracking-widest shadow-lg transition-all transform text-xs ${isFormModified ? 'hover:-translate-y-0.5 hover:opacity-90' : 'opacity-70'}`}
                            >
                                {modalMode === 'add' ? 'Create User' : 'Save Changes'}
                            </button>
                        </form>
                    </div>
                 </div>
            )}

            {/* Archive Confirmation Modal */}
            {isArchiveModalOpen && userToArchive && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm md:max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 text-center">
                            <div className={`mx-auto flex items-center justify-center mb-4 ${userToArchive.isArchived ? 'text-emerald-600' : 'text-red-600'}`}>
                                {userToArchive.isArchived ? (
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                ) : (
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                )}
                            </div>
                            <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2">
                                {userToArchive.isArchived ? 'Restore User?' : 'Archive User?'}
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                                Are you sure you want to {userToArchive.isArchived ? 'restore' : 'archive'} <span className="font-bold text-gray-900 dark:text-white">{userToArchive.name}</span>?
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setIsArchiveModalOpen(false)}
                                    className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmArchive}
                                    style={{ backgroundColor: '#111827' }}
                                    className="flex-1 py-2.5 text-white rounded-xl font-bold text-sm shadow-md hover:opacity-90 transition-all transform hover:-translate-y-0.5"
                                >
                                    Confirm
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserList;
