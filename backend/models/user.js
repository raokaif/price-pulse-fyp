const { getDB } = require('../config/database');

async function createUser({ name, email, passwordHash }) {
  const db = getDB();
  const coll = db.collection('login');
  const doc = { email, name, password: passwordHash, createdAt: new Date(), failedAttempts: 0, lockUntil: null, isVerified: false, otp: null, otpExpiresAt: null };
  await coll.insertOne(doc);
  return { email, name };
}

async function findByEmail(email) {
  const db = getDB();
  return db.collection('login').findOne({ email });
}

async function findByEmailOrName(identifier) {
  const db = getDB();
  const value = String(identifier || '').trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return db.collection('login').findOne({
    $or: [
      { email: lower },
      { name: value },
      { name: { $regex: `^${escaped}$`, $options: 'i' } }
    ]
  });
}

async function findPendingByEmail(email) {
  const db = getDB();
  return db.collection('pending_signups').findOne({ email });
}

async function createPendingSignup({ name, email, passwordHash, otp, otpExpiresAt }) {
  const db = getDB();
  const coll = db.collection('pending_signups');
  const doc = { name, email, password: passwordHash, otp, otpExpiresAt, createdAt: new Date() };
  await coll.updateOne({ email }, { $set: doc }, { upsert: true });
  return { email, name };
}

async function updatePendingOtp(email, otp, otpExpiresAt) {
  const db = getDB();
  return db.collection('pending_signups').updateOne({ email }, { $set: { otp, otpExpiresAt } });
}

async function deletePending(email) {
  const db = getDB();
  return db.collection('pending_signups').deleteOne({ email });
}

async function createUserFromPending(email) {
  const db = getDB();
  const pending = await db.collection('pending_signups').findOne({ email });
  if (!pending) return null;
  const loginColl = db.collection('login');
  const { name, password } = pending;
  const doc = { email, name, password, createdAt: new Date(), failedAttempts: 0, lockUntil: null, isVerified: true };
  await loginColl.updateOne({ email }, { $set: doc }, { upsert: true });
  await db.collection('pending_signups').deleteOne({ email });
  return { email, name };
}

async function findPublicByEmail(email) {
  const db = getDB();
  return db.collection('login').findOne({ email }, { projection: { password: 0 } });
}

async function updatePassword(email, hash) {
  const db = getDB();
  return db.collection('login').updateOne({ email }, { $set: { password: hash } });
}

async function incrementFailedAttempts(email) {
  const db = getDB();
  const user = await db.collection('login').findOne({ email });
  const failed = (user && user.failedAttempts) ? user.failedAttempts + 1 : 1;
  const update = { $set: { failedAttempts: failed } };
  if (failed >= 5) update.$set.lockUntil = Date.now() + (15 * 60 * 1000);
  await db.collection('login').updateOne({ email }, update);
}

async function resetFailedAttempts(email) {
  const db = getDB();
  return db.collection('login').updateOne({ email }, { $set: { failedAttempts: 0, lockUntil: null } });
}

async function setOtp(email, otp, expiresAt) {
  const db = getDB();
  return db.collection('login').updateOne({ email }, { $set: { otp, otpExpiresAt: expiresAt } });
}

async function clearOtp(email) {
  const db = getDB();
  return db.collection('login').updateOne({ email }, { $set: { otp: null, otpExpiresAt: null } });
}

async function verifyOtp(email, otp) {
  const db = getDB();
  const user = await db.collection('login').findOne({ email });
  if (!user) return false;
  if (!user.otp || !user.otpExpiresAt) return false;
  if (user.otp !== otp) return false;
  if (user.otpExpiresAt < Date.now()) return false;
  await db.collection('login').updateOne({ email }, { $set: { isVerified: true, otp: null, otpExpiresAt: null } });
  return true;
}

// Check OTP validity without mutating the user's verified flag (for password reset / login via OTP)
async function checkOtp(email, otp) {
  const db = getDB();
  const user = await db.collection('login').findOne({ email });
  if (!user) return false;
  if (!user.otp || !user.otpExpiresAt) return false;
  if (user.otp !== otp) return false;
  if (user.otpExpiresAt < Date.now()) return false;
  return true;
}

async function setVerified(email) {
  const db = getDB();
  return db.collection('login').updateOne({ email }, { $set: { isVerified: true } });
}

module.exports = { createUser, findByEmail, findByEmailOrName, findPublicByEmail, updatePassword, incrementFailedAttempts, resetFailedAttempts, setOtp, clearOtp, verifyOtp, setVerified, findPendingByEmail, createPendingSignup, updatePendingOtp, deletePending, createUserFromPending, checkOtp };
