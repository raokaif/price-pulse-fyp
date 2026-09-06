import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { isAuthenticated, clearToken } from '../utils/auth';

export default function NavBar() {
  const nav = useNavigate();
  function handleLogout() { clearToken(); nav('/'); }
  return (
    <header className="top-nav">
      <div className="nav-inner">
        <Link to="/" className="logo"><span className="logo-mark">P</span>PricePulse</Link>
        <nav className="primary-nav">
          <ul className="nav-links">
            <li><NavLink to="/" end>Home</NavLink></li>
            <li><NavLink to="/about">About</NavLink></li>
            {isAuthenticated() ? (
              <>
                <li><NavLink to="/profile">Profile</NavLink></li>
                <li><button className="nav-link-btn" onClick={handleLogout}>Logout</button></li>
              </>
            ) : (
              <>
                <li><NavLink to="/login">Login</NavLink></li>
                <li><NavLink to="/signup" className="signup-nav-btn">Signup</NavLink></li>
              </>
            )}
          </ul>
        </nav>
      </div>
    </header>
  );
}
