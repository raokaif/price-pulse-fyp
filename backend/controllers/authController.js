const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../config/database');
const { getEmailFromRequest } = require('../utils/auth');
const userModel = require('../models/user');
const mailer = require('../services/mailer');
const priceTracker = require('../services/priceTracker');
const scraper = require('../services/scraper');
const { normalizeProduct } = require('../utils/productNormalizer');
const { signupSchema, loginSchema, verifySchema, forgotSchema, resetPasswordSchema, loginOtpSchema, resendOtpSchema, validate } = require('../utils/validation');

const router = express.Router();

function isDevelopment() {
  return (process.env.NODE_ENV || 'development') !== 'production';
}

function otpDeliveryResponse(baseMessage, sendError, otp) {
  if (!sendError) return { status: 200, body: { message: baseMessage } };
  if (isDevelopment()) {
    return {
      status: 200,
      body: {
        message: 'Email sending failed, but development mode is enabled. Use the code shown below.',
        devOtp: otp
      }
    };
  }
  return {
    status: 502,
    body: { error: 'Could not send OTP email. Check SMTP settings and try again.' }
  };
}

function isMissingPrice(product = {}) {
  const normalized = product.normalized ? product : normalizeProduct(product);
  const priceValue = normalized.normalized && normalized.normalized.priceValue;
  return !normalized.price && (!Number.isFinite(priceValue) || priceValue <= 0);
}

async function refreshProductBeforeTracking(product = {}) {
  if (!product.link || !isMissingPrice(product)) return product;
  return scraper.refreshTrackedProduct(product).catch(err => {
    console.error('Track product price refresh failed:', err.message || err);
    return product;
  });
}

// Simple health/info route
router.get('/about', (req, res) => res.json({ name: 'PricePulse API', version: '1.0.0' }));

// POST /signup -> create pending signup and send OTP (returns 202)
router.post('/signup', validate(signupSchema), async (req, res) => {
  try {
    const { name, email, password, confirm } = req.body;

    const existing = await userModel.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'Account already exists with this email.' });

    const pending = await userModel.findPendingByEmail(email);
    // Hash password using bcrypt with salt rounds = 10
    const hash = await bcrypt.hash(password, 10);
    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutes
    
    if (pending) {
      await userModel.updatePendingOtp(email, otp, expiresAt);
    } else {
      await userModel.createPendingSignup({ name, email, passwordHash: hash, otp, otpExpiresAt: expiresAt });
    }
    
    let sendError = false;
    try {
      await mailer.sendOTPEmail({ to: email, name, otp });
    } catch (e) { console.error('OTP send failed', e.message || e); sendError = true; }

    const delivery = otpDeliveryResponse('Verification code sent to your email.', sendError, otp);
    return res.status(delivery.status === 200 ? 202 : delivery.status).json(delivery.body);
  } catch (err) {
    console.error('Signup error:', err.message || err);
    return res.status(500).json({ error: 'Server error. Try again later.' });
  }
});

// POST /login -> issue JWT on success
router.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const { email: identifier, password } = req.body;

    const user = await userModel.findByEmailOrName(identifier);
    if (!user) return res.status(401).json({ error: 'No account found with that email or name.' });
    if (!user.isVerified) return res.status(401).json({ error: 'Please verify your email before logging in.' });
    const email = user.email;

    const now = Date.now();
    if (user.lockUntil && user.lockUntil > now) {
      const mins = Math.ceil((user.lockUntil - now) / (60 * 1000));
      return res.status(423).json({ error: `Account locked. Try again in ${mins} minute(s).` });
    }

    let passwordMatches = false;
    const stored = user.password || '';
    try {
      // Use bcrypt to compare passwords
      if (stored && stored.startsWith('$2')) {
        passwordMatches = await bcrypt.compare(password, stored);
      } else {
        // Fallback for plain text (for backward compatibility)
        passwordMatches = (stored === password);
      }
    } catch (e) { passwordMatches = false; }

    if (!passwordMatches) {
      await userModel.incrementFailedAttempts(email);
      return res.status(401).json({ error: 'Invalid credentials. Please try again.' });
    }

    await userModel.resetFailedAttempts(email);
    
    // Upgrade plain text passwords to bcrypt hashing
    if (stored && !stored.startsWith('$2')) {
      try {
        const hash = await bcrypt.hash(password, 10);
        await userModel.updatePassword(email, hash);
      } catch (e) {
        console.error('Password upgrade failed:', e.message);
      }
    }

    const token = jwt.sign({ email }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '24h' });
    return res.json({ token, user: await userModel.findPublicByEmail(email) });
  } catch (err) {
    console.error('Login error:', err.message || err);
    return res.status(500).json({ error: 'Server error. Try again later.' });
  }
});

// POST /verify -> confirm pending signup and issue JWT
router.post('/verify', validate(verifySchema), async (req, res) => {
  try {
    const { email, otp } = req.body;

    const pending = await userModel.findPendingByEmail(email);
    if (!pending) return res.status(400).json({ error: 'No pending signup found for that email.' });
    if (!pending.otp || !pending.otpExpiresAt || pending.otp !== otp || pending.otpExpiresAt < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    await userModel.createUserFromPending(email);
    const token = jwt.sign({ email }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '24h' });
    return res.json({ token, user: await userModel.findPublicByEmail(email) });
  } catch (err) {
    console.error('Verify error', err.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /forgot -> request OTP for passwordless login / reset
router.post('/forgot', validate(forgotSchema), async (req, res) => {
  try {
    const { email } = req.body;
    
    const user = await userModel.findByEmail(email);
    if (!user) return res.status(404).json({ error: 'No account found with that email.' });
    
    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    const expiresAt = Date.now() + (10 * 60 * 1000);
    await userModel.setOtp(email, otp, expiresAt);
    
    let sendErr = false;
    try {
      await mailer.sendOTPEmail({ to: email, name: user.name, otp });
    } catch (e) {
      console.error('Forgot OTP send failed', e.message || e);
      sendErr = true;
    }
    
    const delivery = otpDeliveryResponse('OTP sent to your email.', sendErr, otp);
    return res.status(delivery.status).json(delivery.body);
  } catch (err) {
    console.error('Forgot error', err.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /login-otp -> verify OTP and return JWT
router.post('/login-otp', validate(loginOtpSchema), async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    const ok = await userModel.checkOtp(email, otp);
    if (!ok) return res.status(400).json({ error: 'Invalid or expired code.' });
    
    await userModel.clearOtp(email);
    const token = jwt.sign({ email }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '24h' });
    return res.json({ token, user: await userModel.findPublicByEmail(email) });
  } catch (err) {
    console.error('Login-OTP error', err.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /reset-password -> verify OTP and reset password
router.post('/reset-password', validate(resetPasswordSchema), async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    
    const user = await userModel.findByEmail(email);
    if (!user) return res.status(404).json({ error: 'No account found with that email.' });
    
    // Check if OTP is valid
    const ok = await userModel.checkOtp(email, otp);
    if (!ok) return res.status(400).json({ error: 'Invalid or expired verification code.' });
    
    // Hash new password
    const hash = await bcrypt.hash(password, 10);
    
    // Update password and clear OTP
    await userModel.updatePassword(email, hash);
    await userModel.clearOtp(email);
    
    // Send confirmation email
    try {
      await mailer.sendPasswordResetEmail({ to: email, name: user.name });
    } catch (e) {
      console.error('Password reset confirmation email failed', e.message || e);
    }
    
    return res.json({ message: 'Password reset successfully. You can now login with your new password.' });
  } catch (err) {
    console.error('Reset password error', err.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /resend-otp -> resend OTP for pending signup or existing user
router.post('/resend-otp', validate(resendOtpSchema), async (req, res) => {
  try {
    const { email } = req.body;
    
    const pending = await userModel.findPendingByEmail(email);
    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    const expiresAt = Date.now() + (10 * 60 * 1000);
    let sendError = false;
    
    if (pending) {
      await userModel.updatePendingOtp(email, otp, expiresAt);
      try {
        await mailer.sendOTPEmail({ to: email, name: pending.name, otp });
      } catch (e) {
        console.error('Resend otp failed (pending)', e.message || e);
        sendError = true;
      }
      const delivery = otpDeliveryResponse('Verification code resent to your email.', sendError, otp);
      return res.status(delivery.status).json(delivery.body);
    }
    
    const user = await userModel.findByEmail(email);
    if (!user) return res.status(404).json({ error: 'No account with that email.' });
    
    await userModel.setOtp(email, otp, expiresAt);
    try {
      await mailer.sendOTPEmail({ to: email, name: user.name, otp });
    } catch (e) {
      console.error('Resend otp failed (login)', e.message || e);
      sendError = true;
    }
    
    const delivery = otpDeliveryResponse('Verification code resent to your email.', sendError, otp);
    return res.status(delivery.status).json(delivery.body);
  } catch (err) {
    console.error('Resend otp error', err.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /profile -> returns current user's public profile and product history
router.get('/profile', async (req, res) => {
  try {
    const email = getEmailFromRequest(req);
    if (!email) return res.status(401).json({ error: 'Unauthorized' });
    const user = await userModel.findPublicByEmail(email);
    const productModel = require('../models/product');
    const trackedProductModel = require('../models/trackedProduct');
    const history = await productModel.aggregateHistory(email);
    const products = await productModel.getProductsByUser(email, 30);
    const trackedProducts = await trackedProductModel.getTrackedProductsByUser(email);
    return res.json({ user, history, products, trackedProducts });
  } catch (err) {
    console.error('Profile error:', err.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/tracked-products', async (req, res) => {
  try {
    const email = getEmailFromRequest(req);
    if (!email) return res.status(401).json({ error: 'Unauthorized' });
    const product = req.body.product && typeof req.body.product === 'object' ? req.body.product : req.body;
    const trackedProductModel = require('../models/trackedProduct');
    const refreshedProduct = await refreshProductBeforeTracking(product);
    const trackedProduct = await trackedProductModel.trackProduct(email, refreshedProduct);
    const refreshedPrice = isMissingPrice(product) && !isMissingPrice(refreshedProduct);
    return res.status(201).json({
      trackedProduct,
      refreshedPrice,
      message: refreshedPrice
        ? 'Product added to tracking with the latest store price.'
        : 'Product added to tracking.'
    });
  } catch (err) {
    console.error('Track product error:', err.message || err);
    return res.status(400).json({ error: err.message || 'Could not track product.' });
  }
});

router.delete('/tracked-products/:id', async (req, res) => {
  try {
    const email = getEmailFromRequest(req);
    if (!email) return res.status(401).json({ error: 'Unauthorized' });
    const trackedProductModel = require('../models/trackedProduct');
    const removed = await trackedProductModel.removeTrackedProduct(email, req.params.id);
    return res.json({ removed });
  } catch (err) {
    console.error('Remove tracked product error:', err.message || err);
    return res.status(500).json({ error: 'Could not remove tracked product.' });
  }
});

router.post('/tracked-products/check-now', async (req, res) => {
  try {
    const email = getEmailFromRequest(req);
    if (!email) return res.status(401).json({ error: 'Unauthorized' });
    const result = await priceTracker.checkDueTrackedProducts(50);
    return res.json({ message: 'Tracked product price check completed.', ...result });
  } catch (err) {
    console.error('Manual tracked product check error:', err.message || err);
    return res.status(500).json({ error: 'Could not run tracked product check.' });
  }
});

module.exports = router;
