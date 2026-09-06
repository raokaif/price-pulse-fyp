export function setToken(token) { localStorage.setItem('pp_token', token); }
export function getToken() { return localStorage.getItem('pp_token'); }
export function clearToken() { 
  localStorage.removeItem('pp_token'); 
  // Dispatch event to notify components about logout
  window.dispatchEvent(new Event('logout'));
}
export function isAuthenticated() { return !!getToken(); }
