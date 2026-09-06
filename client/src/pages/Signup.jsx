import React, { useState, useEffect } from 'react';
import api from '../api';
import { useNavigate, useLocation } from 'react-router-dom';

export default function Signup(){
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [msg,setMsg]=useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const location = useLocation();

  // Restore form data if coming back from verify page
  useEffect(() => {
    if (location.state?.formData) {
      const { name, email, password, confirm } = location.state.formData;
      setName(name);
      setEmail(email);
      setPassword(password);
      setConfirm(confirm);
    }
  }, [location.state]);

  // Password validation checks for display only
  const passwordChecks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    match: password && confirm && password === confirm,
  };

  // Button can be clicked if all fields filled
  const canSubmit = name && email && password && confirm && !loading;
  const passwordActions = getPasswordActions(password, confirm);

  async function submit(e){
    e.preventDefault();
    setMsg(null);
    if (passwordActions.length > 0) {
      setMsg({
        type: 'error',
        text: 'Password is not correct. Please fix these actions:',
        details: passwordActions
      });
      return;
    }
    setLoading(true);
    try{
      const res = await api.post('/signup',{ name, email, password, confirm });
      setMsg({ type:'success', text: res.data.message || 'Verification code sent.' });
      // Pass form data to verify page so it can be restored if user goes back
      setTimeout(() => {
        nav(`/verify?email=${encodeURIComponent(email)}`, { 
          state: { formData: { name, email, password, confirm } } 
        });
      }, 800);
    }catch(err){ 
      const errors = err?.response?.data?.errors || [];
      setMsg({
        type:'error',
        text: err?.response?.data?.error || 'Signup failed',
        details: errors.length > 1 ? errors.slice(1) : []
      });
      setLoading(false);
    }
  }

  return (
    <div className="auth-center">
      <div className="signup-box">
        <h1>Create Account</h1>
        <p>Join us today and start saving your favorite products</p>
        
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Full Name</label>
            <input 
              value={name} 
              onChange={e=>setName(e.target.value)} 
              placeholder="John Doe"
              required
            />
          </div>

          <div className="form-group">
            <label>Email Address</label>
            <input 
              value={email} 
              onChange={e=>setEmail(e.target.value)} 
              type="email"
              placeholder="your@email.com"
              required
            />
            <div style={{fontSize:12, marginTop:8, color:'#555'}}>Hotmail/Outlook and other common providers are supported.</div>
          </div>

          <div className="form-group">
            <label>Password</label>
            <div style={{position:'relative'}}>
              <input 
                value={password} 
                onChange={e=>setPassword(e.target.value)} 
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
            <div style={{position:'relative'}}>
              <input 
                value={confirm} 
                onChange={e=>setConfirm(e.target.value)} 
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm your password"
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
                fontSize:'12px', 
                marginTop:'8px',
                color: passwordChecks.match ? '#27ae60' : '#e74c3c',
                fontWeight: '500'
              }}>
                {passwordChecks.match ? '✓ Passwords match' : '✗ Passwords do not match'}
              </div>
            )}
          </div>

          {msg && (
            <div className={`message ${msg.type}`}>
              <div>{msg.text}</div>
              {msg.details && msg.details.length > 0 && (
                <ul className="message-actions">
                  {msg.details.map(item => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
          )}
          
          <button 
            className="btn" 
            type="submit"
            disabled={!canSubmit}
            style={{marginTop: '24px'}}
          >
            {loading ? 'Signing up...' : 'Sign up'}
          </button>
        </form>

        <div className="form-link">
          Already have an account? <a href="/login">Log in</a>
        </div>
      </div>
    </div>
  );
}

function getPasswordActions(password, confirm) {
  const actions = [];
  if (password.length < 8) actions.push('Use at least 8 characters.');
  if (!/[A-Z]/.test(password)) actions.push('Add at least one uppercase letter.');
  if (!/[a-z]/.test(password)) actions.push('Add at least one lowercase letter.');
  if (!/[0-9]/.test(password)) actions.push('Add at least one number.');
  if (!confirm) actions.push('Confirm your password.');
  else if (password !== confirm) actions.push('Make both passwords exactly the same.');
  return actions;
}
