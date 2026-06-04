const { Resend } = require('resend');

let _resend;

function getResend() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY env var is required');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

module.exports = new Proxy({}, {
  get(_, prop) {
    return getResend()[prop];
  },
});
