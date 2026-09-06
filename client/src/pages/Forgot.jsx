import React, { useState } from 'react';
import api from '../api';
import { useNavigate } from 'react-router-dom';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const canSubmit = email && !loading;

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const res = await api.post('/forgot', { email });
      const devCode = res.data.devOtp ? ` Code: ${res.data.devOtp}` : '';
      setMsg({ type: 'success', text: `${res.data.message || 'Verification code sent to your email.'}${devCode}` });
      setTimeout(() => {
        nav(`/reset?email=${encodeURIComponent(email)}`);
      }, res.data.devOtp ? 2500 : 1000);
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.error || err?.response?.data?.message || 'Failed to send verification code' });
      setLoading(false);
    }
  }

  return (
    <div className="auth-center">
      <div className="login-box">
        <h1>Reset Password</h1>
        <p>Enter your email address and we'll send you a verification code</p>

        <form onSubmit={submit}>
          <div className="form-group">
            <label>Email Address</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              placeholder="your@email.com"
              required
            />
          </div>

          {msg && <div className={`message ${msg.type}`}>{msg.text}</div>}

          <button
            className="btn"
            type="submit"
            disabled={!canSubmit}
            style={{ marginTop: '24px' }}
          >
            {loading ? 'Sending...' : 'Send Verification Code'}
          </button>
        </form>

        <div className="form-link">
          Remember your password? <a href="/login">Log in</a>
        </div>

        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e0e0e0', textAlign: 'center' }}>
          <p style={{ color: '#7f8c8d', fontSize: '14px', marginBottom: '12px' }}>
            Don't have an account?
          </p>
          <a href="/signup" style={{ color: '#667eea', textDecoration: 'none', fontSize: '14px', fontWeight: '600' }}>
            Create one here
          </a>
        </div>
      </div>
    </div>
  );
}
