const { z } = require('zod');

// Email validation — keep standard RFC email check but explicitly allow common
// Microsoft-hosted addresses (hotmail, outlook) in case some sites use
// slightly unusual variants. We still prefer the built-in email check.
const emailSchema = z
  .string('Email is required')
  .trim()
  .transform(s => (s || '').toLowerCase())
  .refine((val) => {
    // First try the standard email validation
    try { z.string().email().parse(val); return true; } catch (e) { /* fallthrough */ }
    // If standard validation fails, allow common hotmail/outlook variants
    return /@(?:hotmail|outlook)\.[a-z.]{2,}$/i.test(val);
  }, {
    message: 'Invalid email address'
  });

// Password validation - at least 8 chars, 1 uppercase, 1 lowercase, 1 number
const passwordSchema = z
  .string('Password is required')
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

// Weak password (for login - we accept weaker passwords for backward compatibility)
const weakPasswordSchema = z
  .string('Password is required')
  .min(6, 'Password must be at least 6 characters');

const loginIdentifierSchema = z
  .string('Email or name is required')
  .trim()
  .min(2, 'Email or name is required')
  .max(100, 'Email or name is too long');

// Signup validation schema
const signupSchema = z.object({
  name: z
    .string('Name is required')
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be less than 100 characters')
    .trim(),
  email: emailSchema,
  password: passwordSchema,
  confirm: z.string('Confirm password is required'),
}).refine((data) => data.password === data.confirm, {
  message: 'Passwords do not match',
  path: ['confirm'],
});

// Login validation schema
const loginSchema = z.object({
  email: loginIdentifierSchema,
  password: weakPasswordSchema,
});

// Email verification schema
const verifySchema = z.object({
  email: emailSchema,
  otp: z
    .string('Verification code is required')
    .regex(/^\d{6}$/, 'Verification code must be 6 digits'),
});

// Forgot password schema
const forgotSchema = z.object({
  email: emailSchema,
});

// Reset password with OTP schema
const resetPasswordSchema = z.object({
  email: emailSchema,
  otp: z
    .string('Code is required')
    .regex(/^\d{6}$/, 'Code must be 6 digits'),
  password: passwordSchema,
  confirm: z.string('Confirm password is required'),
}).refine((data) => data.password === data.confirm, {
  message: 'Passwords do not match',
  path: ['confirm'],
});

// Login with OTP schema
const loginOtpSchema = z.object({
  email: emailSchema,
  otp: z
    .string('Code is required')
    .regex(/^\d{6}$/, 'Code must be 6 digits'),
});

// Resend OTP schema
const resendOtpSchema = z.object({
  email: emailSchema,
});

// Helper function to validate request body
const validate = (schema) => (req, res, next) => {
  try {
    const validated = schema.parse(req.body);
    req.body = validated;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues || error.errors || [];
      const messages = issues.length > 0
        ? issues.map(err => err.message)
        : ['Validation error'];
      return res.status(400).json({
        error: messages[0] || 'Validation error',
        errors: messages,
        fields: issues.map(err => ({
          path: Array.isArray(err.path) ? err.path.join('.') : '',
          message: err.message
        }))
      });
    }
    return res.status(400).json({ error: 'Invalid request' });
  }
};

module.exports = {
  emailSchema,
  passwordSchema,
  weakPasswordSchema,
  signupSchema,
  loginSchema,
  verifySchema,
  forgotSchema,
  resetPasswordSchema,
  loginOtpSchema,
  resendOtpSchema,
  validate,
};
