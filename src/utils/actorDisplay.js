const textValue = (value) => String(value || '').trim();

export const getActorDisplayName = (actorRef, storedName, fallback = 'System') => {
  const reference = actorRef && typeof actorRef === 'object' ? actorRef : null;

  return textValue(reference?.displayName)
    || textValue(reference?.name)
    || textValue(reference?.username)
    || textValue(storedName)
    || fallback;
};

export const getActorRoleLabel = (actorRef, fallbackRole = '') => {
  const role = textValue(actorRef?.role || fallbackRole).toLowerCase();

  if (role === 'superadmin' || role === 'super admin') return 'Super Admin';
  if (role === 'admin') return 'Admin';
  if (role === 'cashier') return 'Cashier';

  return '';
};
