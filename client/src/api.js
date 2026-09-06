import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3100';

const api = axios.create({ baseURL: API_URL, timeout: 240000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pp_token');
  if (token) config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
  return config;
});

export default api;
