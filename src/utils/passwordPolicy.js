export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_REQUIREMENTS = [
  { key: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters` },
  { key: 'uppercase', label: 'At least one uppercase letter' },
  { key: 'lowercase', label: 'At least one lowercase letter' },
  { key: 'number', label: 'At least one number' },
  { key: 'special', label: 'At least one special character' },
];

export const getPasswordChecks = (password = '') => {
  const value = String(password || '');

  return {
    length: value.length >= PASSWORD_MIN_LENGTH,
    lowercase: /[a-z]/.test(value),
    uppercase: /[A-Z]/.test(value),
    number: /\d/.test(value),
    special: /[^A-Za-z\d]/.test(value),
  };
};

export const isValidPassword = (password = '') => (
  Object.values(getPasswordChecks(password)).every(Boolean)
);
