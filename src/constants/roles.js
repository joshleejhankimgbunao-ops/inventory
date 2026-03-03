// Centralized role definitions and permission helpers
export const ROLES = {
    SUPER_ADMIN: 'superadmin', // the single, all‑powerful account (was previously "admin")
    ADMIN:       'admin',      // new mid‑level user
    CASHIER:     'cashier'
};

// Human readable names for display purposes
export const roleNames = {
    [ROLES.SUPER_ADMIN]: 'Super Admin',
    [ROLES.ADMIN]: 'Admin',
    [ROLES.CASHIER]: 'Cashier'
};

// Order of privilege for simple comparisons
const _roleOrder = [ROLES.CASHIER, ROLES.ADMIN, ROLES.SUPER_ADMIN];

export const isAtLeast = (role, minRole) => {
    const i1 = _roleOrder.indexOf(role);
    const i2 = _roleOrder.indexOf(minRole);
    if (i1 === -1 || i2 === -1) return false;
    return i1 >= i2;
};

// Page‑level access map. Any page not listed here defaults to SUPER_ADMIN only.
export const pageAccess = {
    Dashboard:      [_roleOrder[2], _roleOrder[1], _roleOrder[0]],
    Recommendation: [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    // point‑of‑sale should be available to admin again alongside superadmin and cashiers
    POS:            [_roleOrder[2], _roleOrder[1], _roleOrder[0]],
    // history/logs should also be visible to cashiers (they may need to review their own sales)
    History:        [ROLES.SUPER_ADMIN, ROLES.CASHIER],
    Inventory:      [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    ProductList:    [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    Reports:        [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    Settings:       [ROLES.SUPER_ADMIN],
    UserList:       [ROLES.SUPER_ADMIN],
    Partners:       [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    Profile:        [_roleOrder[2], _roleOrder[1], _roleOrder[0]]
};

export const canAccess = (role, page) => {
    const allowed = pageAccess[page];
    if (!allowed) {
        // default to super admin only
        return role === ROLES.SUPER_ADMIN;
    }
    return allowed.includes(role);
};
