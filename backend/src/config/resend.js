const { Resend } = require('resend');

if (!process.env.RESEND_API_KEY) throw new Error('Missing required env var: RESEND_API_KEY');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = resend;
