export const validateEvidenceFiles = (files, {
  maxFiles = 3,
  maxBytes = 5 * 1024 * 1024,
  allowedTypes = ['image/jpeg', 'image/png'],
} = {}) => {
  if (files.length > maxFiles) return `Choose no more than ${maxFiles} files.`;
  if (files.some((file) => !allowedTypes.includes(String(file.type || '').toLowerCase()))) {
    return `Allowed formats: ${allowedTypes.includes('application/pdf') ? 'JPG, PNG, or PDF' : 'JPG or PNG'}.`;
  }
  if (files.some((file) => file.size < 1 || file.size > maxBytes)) {
    return `Each file must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`;
  }
  return '';
};
