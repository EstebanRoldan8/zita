const CryptoJS = require('crypto-js');

function encrypt(text) {
  return CryptoJS.AES.encrypt(text, process.env.ENCRYPT_SECRET).toString();
}

function decrypt(encryptedText) {
  const bytes = CryptoJS.AES.decrypt(encryptedText, process.env.ENCRYPT_SECRET);
  return bytes.toString(CryptoJS.enc.Utf8);
}

module.exports = { encrypt, decrypt };
