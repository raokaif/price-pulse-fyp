# OTP Email Configuration Guide

## Problem: Not Receiving OTP Emails

The `.env` file was missing! You need to configure your email settings.

---

## 🔧 Solution: Configure Gmail SMTP

### Step 1: Generate Gmail App Password

1. Go to your **Google Account**: https://myaccount.google.com
2. Click **"Security"** in the left menu
3. Find **"App passwords"** (requires 2FA enabled)
4. Select **Mail** and **Windows Computer**
5. Google will generate a 16-character password
6. Copy this password

### Step 2: Update `.env` File

Edit `backend/.env` and replace with your credentials:

```env
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=pricepulse
PORT=3100
NODE_ENV=development

JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
CORS_ORIGIN=http://localhost:5173

# SMTP Configuration
SMTP_USER=your_email@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_FROM=PricePulse <noreply@pricepulse.app>
SMTP_IGNORE_TLS=false
```

### Step 3: Replace Placeholders

- **SMTP_USER**: Your full Gmail address (e.g., `hamzashamshad136020@gmail.com`)
- **SMTP_PASS**: The 16-character app password (e.g., `xxxx xxxx xxxx xxxx`)

### Step 4: Restart Backend

The backend will auto-restart via Nodemon. Look for:
```
✅ Connected to MongoDB
🚀 API server running on port 3100
```

---

## ✅ Testing Email

### Try Signup:

```bash
curl -X POST http://localhost:3100/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@gmail.com",
    "password": "SecurePass123",
    "confirm": "SecurePass123"
  }'
```

### Response (202):
```json
{
  "message": "Verification code sent to your email."
}
```

---

## 🧪 Alternative: Test Email Service (Ethereal)

If you don't want to use Gmail, the system defaults to **Ethereal** (free test email):

### How It Works:
1. First signup request creates test email account
2. Email preview URL logged to console:
   ```
   Preview email: https://ethereal.email/message/...
   ```
3. Click the link to see the email with OTP

### To Enable:
Leave `SMTP_USER` and `SMTP_PASS` empty in `.env`:
```env
SMTP_USER=
SMTP_PASS=
```

---

## 🔑 Gmail App Password Setup (Detailed)

### Prerequisites:
✅ Gmail account  
✅ 2-Factor Authentication enabled  
✅ Not using a Google Workspace account

### Steps:
1. **Enable 2FA**
   - Go to https://security.google.com
   - Click "2-Step Verification"
   - Follow the setup

2. **Generate App Password**
   - Go back to Security page
   - Find "App passwords" (appears after 2FA)
   - Select: App = Mail, Device = Windows Computer
   - Google generates 16-character password

3. **Copy Password**
   - It looks like: `xxxx xxxx xxxx xxxx`
   - Remove spaces for .env: `xxxxxxxxxxxxxxxx`

4. **Paste in .env**
   ```
   SMTP_PASS=xxxxxxxxxxxxxxxx
   ```

---

## 🐛 Troubleshooting

### Email Not Sending (Real SMTP)

**Error: Invalid credentials**
- Double-check app password (16 characters)
- Ensure 2FA is enabled
- Try generating a new app password

**Error: Connection timeout**
- Check internet connection
- Verify SMTP_HOST is: `smtp.gmail.com`
- Verify SMTP_PORT is: `465`
- Ensure SMTP_SECURE is: `true`

### Using Test Email (Ethereal)

**Can't find preview URL?**
- Check backend console output
- Look for line: `Preview email: https://ethereal.email/...`
- Open that URL in browser to view email

---

## 📧 Emails Being Sent (Where to Check)

### Gmail SMTP ✉️
- Check your **Sent folder** in Gmail
- Check recipient's **Inbox** (may be in Spam)

### Ethereal Test Email 🧪
- Click preview URL in console
- View email in browser
- Copy OTP from email

---

## ✨ After Configuration

1. Create a new `.env` file (if not exists)
2. Add your credentials
3. Restart backend (auto via Nodemon)
4. Test signup flow
5. Check email for OTP code
6. Use OTP to verify account
7. Login to see dashboard!

---

## 🚀 Next Steps

Once emails are working:
- Test full signup → verify → login flow
- Try forgot password OTP
- Test product search
- Verify all auth endpoints work

**Good luck!** 🎉
