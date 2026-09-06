import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../api';

export default function Reset() {
  const [search] = useSearchParams();
  const emailParam = search.get('email') || '';
  const [email, setEmail] = useState(emailParam);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  // Password validation checks
  const passwordChecks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    match: password && confirm && password === confirm,
  };

  const canSubmit = email && otp && otp.length === 6 && password && confirm && !loading;

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const res = await api.post('/reset-password', { email, otp, password, confirm });
      setMsg({ type: 'success', text: res.data.message || 'Password reset successfully! Redirecting to login...' });
      setTimeout(() => nav('/login'), 800);
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.error || 'Password reset failed' });
      setLoading(false);
    }
  }

  return (
    <div className="auth-center">
      <div className="verify-box">
        <h1>Reset Your Password</h1>
        <p>Enter the verification code sent to <strong style={{ color: '#2c3e50' }}>{email}</strong></p>

        <form onSubmit={submit}>
          <div className="form-group">
            <label>Email Address</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              placeholder="your@email.com"
              disabled
              style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed' }}
            />
          </div>

          <div className="form-group">
            <label>Verification Code</label>
            <input
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              type="text"
              placeholder="000000"
              maxLength="6"
              inputMode="numeric"
              style={{ textAlign: 'center', fontSize: '24px', letterSpacing: '8px', fontWeight: '600' }}
              required
            />
            <div style={{ fontSize: '12px', color: '#7f8c8d', marginTop: '8px' }}>
              Enter the 6-digit code sent to your email
            </div>
          </div>

          <div className="form-group">
            <label>New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                type={showPassword ? "text" : "password"}
                placeholder="Create a strong password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="password-eye"
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            {/* Password requirements checklist */}
            {password && (
              <div className="password-checker">
                <div className={`checker-item ${passwordChecks.length ? 'valid' : 'invalid'}`}>
                  {passwordChecks.length ? '✓' : '✗'} At least 8 characters
                </div>
                <div className={`checker-item ${passwordChecks.uppercase ? 'valid' : 'invalid'}`}>
                  {passwordChecks.uppercase ? '✓' : '✗'} One uppercase letter (A-Z)
                </div>
                <div className={`checker-item ${passwordChecks.lowercase ? 'valid' : 'invalid'}`}>
                  {passwordChecks.lowercase ? '✓' : '✗'} One lowercase letter (a-z)
                </div>
                <div className={`checker-item ${passwordChecks.number ? 'valid' : 'invalid'}`}>
                  {passwordChecks.number ? '✓' : '✗'} One number (0-9)
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <input
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm your new password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="password-eye"
              >
                {showConfirm ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            {password && confirm && (
              <div style={{
                fontSize: '12px',
                marginTop: '8px',
                color: passwordChecks.match ? '#27ae60' : '#e74c3c',
                fontWeight: '500'
              }}>
                {passwordChecks.match ? '✓ Passwords match' : '✗ Passwords do not match'}
              </div>
            )}
          </div>

          {msg && <div className={`message ${msg.type}`}>{msg.text}</div>}

          <button
            className="btn"
            type="submit"
            disabled={!canSubmit}
            style={{ marginTop: '28px' }}
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>

        <div style={{ marginTop: '24px', textAlign: 'center', paddingTop: '24px', borderTop: '1px solid #e0e0e0' }}>
          <p style={{ color: '#7f8c8d', fontSize: '14px', marginBottom: '12px' }}>
            Didn't receive the code?
          </p>
          <button
            type="button"
            onClick={() => nav('/forgot')}
            style={{
              background: 'none',
              border: 'none',
              color: '#667eea',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600',
              textDecoration: 'underline',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => e.target.style.color = '#764ba2'}
            onMouseLeave={(e) => e.target.style.color = '#667eea'}
          >
            Request New Code
          </button>
        </div>
      </div>
    </div>
  );
}
