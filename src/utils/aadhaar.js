// Aadhaar: exactly 12 digits, never starts with 0 or 1.
// The full number is kept only in component state while typing. It is never
// written to localStorage / drafts and is cleared right after submit.
export const onlyDigits = (v, max = 12) => String(v).replace(/\D/g, '').slice(0, max);
export const formatAadhaar = (d) => d.replace(/(\d{4})(?=\d)/g, '$1 ');
export const aadhaarError = (d) => {
  if (d.length !== 12) return 'Aadhaar number must be exactly 12 digits';
  if (/^[01]/.test(d)) return 'Aadhaar number cannot start with 0 or 1';
  return '';
};

// Health Record ID: 14 digits shown as 91-1234-5678-9012
export const formatHealthId = (v) => {
  const d = onlyDigits(v, 14);
  return [d.slice(0, 2), d.slice(2, 6), d.slice(6, 10), d.slice(10, 14)].filter(Boolean).join('-');
};
