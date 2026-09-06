const jwt = require('jsonwebtoken');

// Extract email from JWT token in Authorization header
function getEmailFromRequest(req) {
  try {
    const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
        return payload && payload.email ? payload.email : null;
      } catch (e) {
        return null;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { getEmailFromRequest };
