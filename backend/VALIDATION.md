# Validation Schema Documentation

## Overview

The backend uses **Zod** for schema validation and **bcrypt** for secure password hashing. This ensures type-safe request validation and strong password security.

## Validation Rules

### Email Validation
- Must be a valid email format (RFC 5322)
- Automatically converted to lowercase
- Trimmed of whitespace
- Used in all authentication endpoints

### Password Validation (Signup)
**Strong Password Requirements:**
- Minimum 8 characters
- At least 1 uppercase letter (A-Z)
- At least 1 lowercase letter (a-z)
- At least 1 number (0-9)

Example: `SecurePass123`

### Password Validation (Login)
**Weak Password (for backward compatibility):**
- Minimum 6 characters
- No other requirements

## Bcrypt Password Hashing

### Features
- **Salt Rounds**: 10 (provides good security-performance balance)
- **Algorithm**: Blowfish-based hashing
- **One-way**: Passwords cannot be decrypted, only compared
- **Automatic Upgrade**: Plain text passwords are automatically upgraded to bcrypt on login

### How It Works
1. When user signs up, password is hashed with bcrypt
2. Hashed password is stored in database (starts with `$2`)
3. During login, password is compared using bcrypt.compare()
4. If old plain text password found, it's automatically upgraded to bcrypt

## Schemas

### 1. Signup Schema
```javascript
{
  name: string (2-100 chars),
  email: valid email,
  password: strong password (8+ chars, upper, lower, number),
  confirm: must match password
}
```

### 2. Login Schema
```javascript
{
  email: valid email,
  password: weak password (6+ chars)
}
```

### 3. Verify Schema
```javascript
{
  email: valid email,
  otp: 6-digit code
}
```

### 4. Forgot Schema
```javascript
{
  email: valid email
}
```

### 5. Login OTP Schema
```javascript
{
  email: valid email,
  otp: 6-digit code
}
```

### 6. Resend OTP Schema
```javascript
{
  email: valid email
}
```

## Usage in Controllers

All routes use the `validate` middleware to automatically validate incoming requests:

```javascript
router.post('/signup', validate(signupSchema), async (req, res) => {
  // req.body is already validated and parsed
  const { name, email, password, confirm } = req.body;
  // ...
});
```

## Error Handling

Invalid requests return 400 status with clear error messages:

```json
{
  "error": "Password must be at least 8 characters"
}
```

## Examples

### Valid Signup Request
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123",
  "confirm": "SecurePass123"
}
```

### Invalid Signup Request
```json
{
  "name": "John Doe",
  "email": "invalid-email",
  "password": "weak",
  "confirm": "weak"
}
```

Response:
```json
{
  "error": "Invalid email address"
}
```

## Security Benefits

1. **Type Safety**: Zod ensures all inputs match expected types
2. **Strong Passwords**: Enforces complexity requirements during signup
3. **Secure Hashing**: Bcrypt prevents password rainbow table attacks
4. **Rate Limiting Ready**: Schema validation prevents malformed requests early
5. **Clear Error Messages**: Users know exactly what validation failed

## Files Modified

- `backend/utils/validation.js` - Zod schemas and validation middleware
- `backend/controllers/authController.js` - Updated to use Zod validation
- `backend/package.json` - Added `zod` dependency

