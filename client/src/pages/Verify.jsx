import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import api from '../api';
import { setToken } from '../utils/auth';

export default function Verify(){
  const [search] = useSearchParams();
  const emailParam = search.get('email') || '';
  const [email, setEmail] = useState(emailParam);
  const [otp, setOtp] = useState('');
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const location = useLocation();

  async function submit(e){
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try{
      const res = await api.post('/verify', { email, otp });
      setToken(res.data.token);
      nav('/', { replace: true });
    }catch(err){ 
      setMsg({ type:'error', text: err?.response?.data?.error || 'Verification failed' });
      setLoading(false);
    }
  }

  const handleResendOtp = async () => {
    setMsg(null);
    setLoading(true);
    try {
      const res = await api.post('/resend-otp', { email });
      setMsg({ type:'success', text: 'New verification code sent to your email!' });
      setLoading(false);
    } catch (err) {
      setMsg({ type:'error', text: err?.response?.data?.error || 'Failed to resend code' });
      setLoading(false);
    }
  };

  return (
    <div className="auth-center">
      <div className="verify-box">
        <h1>Verify Your Email</h1>
        <p>We've sent a 6-digit verification code to <strong style={{color: '#2c3e50'}}>{email}</strong></p>
        
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Email Address</label>
            <input 
              value={email} 
              onChange={e=>setEmail(e.target.value)} 
              type="email"
              placeholder="your@email.com"
              disabled
              style={{backgroundColor: '#f0f0f0', cursor: 'not-allowed'}}
            />
          </div>

          <div className="form-group">
            <label>Verification Code</label>
            <input 
              value={otp} 
              onChange={e=>setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} 
              type="text"
              placeholder="000000"
              maxLength="6"
              inputMode="numeric"
              style={{textAlign: 'center', fontSize: '24px', letterSpacing: '8px', fontWeight: '600'}}
              required
            />
            <div style={{fontSize: '12px', color: '#7f8c8d', marginTop: '8px'}}>
              Enter the 6-digit code
            </div>
          </div>

          {msg && <div className={`message ${msg.type}`}>{msg.text}</div>}
          
          <div className="button-group" style={{marginTop: '28px'}}>
            <button 
              className="btn" 
              type="submit"
              disabled={!otp || otp.length !== 6 || loading}
            >
              {loading ? 'Verifying...' : 'Verify Code'}
            </button>
            <button 
              className="btn btn-secondary" 
              type="button"
              onClick={() => nav('/signup', { state: { formData: location.state?.formData } })}
              disabled={loading}
            >
              Back
            </button>
          </div>
        </form>

        <div style={{marginTop: '24px', textAlign: 'center', paddingTop: '24px', borderTop: '1px solid #e0e0e0'}}>
          <p style={{color: '#7f8c8d', fontSize: '14px', marginBottom: '12px'}}>
            Didn't receive the code?
          </p>
          <button
            type="button"
            onClick={handleResendOtp}
            disabled={loading}
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
            Resend Code
          </button>
        </div>
      </div>
    </div>
  );
}
