const nodemailer = require('nodemailer');

let transporterPromise = null;

async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  transporterPromise = (async () => {
    // If SMTP config is provided via env vars, use it. Otherwise fall back to Ethereal for testing.
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined;
    const secure = (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';

    if (user && pass && host) {
      const ignoreTLS = (process.env.SMTP_IGNORE_TLS || 'false').toLowerCase() === 'true';
      const transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass }, tls: ignoreTLS ? { rejectUnauthorized: false } : undefined });
      return transport;
    }

    const testAccount = await nodemailer.createTestAccount();
    const ignoreTLS = (process.env.SMTP_IGNORE_TLS || 'false').toLowerCase() === 'true';
    return nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
      tls: ignoreTLS ? { rejectUnauthorized: false } : undefined,
    });
  })();

  return transporterPromise;
}

async function sendOTPEmail({ to, name, otp }) {
  const transporter = await getTransporter();

  const fromAddress = process.env.SMTP_FROM || (process.env.SMTP_USER ? `PricePulse <${process.env.SMTP_USER}>` : 'no-reply@pricepulse.local');
  const subject = 'Verify your PricePulse account';
  const text = `Hi ${name || ''},\n\nYour verification code is: ${otp}\nIt will expire in 10 minutes.\n\nIf you did not request this, you can ignore this email.\n\nThanks,\nPricePulse Team`;
  const html = `<p>Hi ${name || ''},</p>
  <p>Your verification code is: <strong>${otp}</strong></p>
  <p>It will expire in 10 minutes.</p>
  <p>If you did not request this, you can ignore this email.</p>
  <p>Thanks,<br/>PricePulse Team</p>`;

  const info = await transporter.sendMail({ from: fromAddress, to, subject, text, html });

  if (nodemailer.getTestMessageUrl && info) {
    const url = nodemailer.getTestMessageUrl(info);
    if (url) console.info('Preview email:', url);
  }

  return info;
}

async function sendPasswordResetEmail({ to, name }) {
  const transporter = await getTransporter();

  const fromAddress = process.env.SMTP_FROM || (process.env.SMTP_USER ? `PricePulse <${process.env.SMTP_USER}>` : 'no-reply@pricepulse.local');
  const subject = 'Password reset successful';
  const text = `Hi ${name || ''},\n\nYour password has been successfully reset. You can now log in with your new password.\n\nIf you did not request this, please contact us immediately.\n\nThanks,\nPricePulse Team`;
  const html = `<p>Hi ${name || ''},</p>
  <p>Your password has been successfully reset.</p>
  <p>You can now log in with your new password.</p>
  <p>If you did not request this, please contact us immediately.</p>
  <p>Thanks,<br/>PricePulse Team</p>`;

  const info = await transporter.sendMail({ from: fromAddress, to, subject, text, html });

  if (nodemailer.getTestMessageUrl && info) {
    const url = nodemailer.getTestMessageUrl(info);
    if (url) console.info('Preview email:', url);
  }

  return info;
}

async function sendPriceChangeEmail({ to, name, product, oldPrice, newPrice }) {
  const transporter = await getTransporter();

  const fromAddress = process.env.SMTP_FROM || (process.env.SMTP_USER ? `PricePulse <${process.env.SMTP_USER}>` : 'no-reply@pricepulse.local');
  const subject = `Price changed: ${product.title || 'Tracked product'}`;
  const productUrl = product.link ? `\nOpen product: ${product.link}` : '';
  const text = `Hi ${name || ''},\n\nA tracked product price changed.\n\n${product.title || 'Tracked product'}\nOld price: ${oldPrice || 'Not available'}\nNew price: ${newPrice || 'Not available'}${productUrl}\n\nThanks,\nPricePulse Team`;
  const html = `<p>Hi ${name || ''},</p>
  <p>A tracked product price changed.</p>
  <p><strong>${product.title || 'Tracked product'}</strong></p>
  <p>Old price: <strong>${oldPrice || 'Not available'}</strong><br/>New price: <strong>${newPrice || 'Not available'}</strong></p>
  ${product.link ? `<p><a href="${product.link}">Open product</a></p>` : ''}
  <p>Thanks,<br/>PricePulse Team</p>`;

  const info = await transporter.sendMail({ from: fromAddress, to, subject, text, html });

  if (nodemailer.getTestMessageUrl && info) {
    const url = nodemailer.getTestMessageUrl(info);
    if (url) console.info('Preview email:', url);
  }

  return info;
}

module.exports = { sendOTPEmail, sendPasswordResetEmail, sendPriceChangeEmail };
