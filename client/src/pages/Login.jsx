import React, { useState } from 'react';
import api from '../api';
import { setToken } from '../utils/auth';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const canSubmit = email && password && !loading;

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const res = await api.post('/login', { email, password });
      setToken(res.data.token);
      nav('/', { replace: true });
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.error || 'Login failed' });
      setLoading(false);
    }
  }

  return (
    <div className="auth-center">
      <div className="login-box">
        <h1>Welcome Back</h1>
        <p>Log in with the email address you used to create your account.</p>

        <form onSubmit={submit}>
          <div className="form-group">
            <label>Email address</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="text"
              placeholder="your@email.com"
              required
            />
            <div style={{ fontSize: 12, color: '#7f8c8d', marginTop: 6 }}>
              You can still enter your account name if that is how your account was created.
            </div>
          </div>

          <div className="form-group">
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="password-eye"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {msg && <div className={`message ${msg.type}`}>{msg.text}</div>}

          <button
            className="btn"
            type="submit"
            disabled={!canSubmit}
            style={{ marginTop: '24px' }}
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <div className="form-link">
          Don't have an account? <a href="/signup">Sign up here</a>
        </div>

        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e0e0e0', textAlign: 'center' }}>
          <a
            href="/forgot"
            style={{ color: '#667eea', textDecoration: 'none', fontSize: '14px', fontWeight: '600', transition: 'all 0.2s' }}
            onMouseEnter={(e) => { e.target.style.color = '#764ba2'; }}
            onMouseLeave={(e) => { e.target.style.color = '#667eea'; }}
          >
            Forgot your password?
          </a>
        </div>
      </div>
    </div>
  );
}
