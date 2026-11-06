export const getSession = () => {
  try { return JSON.parse(sessionStorage.getItem('session')); } catch (e) { return null; }
};
export const setSession = (s) => {
  sessionStorage.setItem('session', JSON.stringify(s));
  localStorage.setItem('role', s.role);
  if (s.token) localStorage.setItem('token', s.token);
};
export const clearSession = () => {
  sessionStorage.clear();
  localStorage.removeItem('role');
  localStorage.removeItem('token');
};
export const getActivePatient = () => {
  try { return JSON.parse(sessionStorage.getItem('activePatient')); } catch (e) { return null; }
};
