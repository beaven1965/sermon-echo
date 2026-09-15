// This runs on Netlify's servers, not in the visitor's browser.
//
// Checks whether an access code (the kind shown after a successful
// payment, or shared by a family member) is one this server genuinely
// issued — without needing to store a list of every code anywhere.
// It works because every code is "random text + signature", and only
// this server (using ACCESS_CODE_SECRET) can produce a matching signature.

const crypto = require('crypto');

function signaturesMatch(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const accessSecret = process.env.ACCESS_CODE_SECRET;
    if (!accessSecret) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server is missing ACCESS_CODE_SECRET as a Netlify environment variable.' }) };
    }

    const { code } = JSON.parse(event.body || '{}');
    const cleaned = (code || '').trim().toUpperCase();
    const match = cleaned.match(/^SE-([0-9A-F]{10})-([0-9A-F]{6})$/);

    if (!match) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valid: false }) };
    }

    const [, randomPart, signature] = match;
    const expected = crypto
      .createHmac('sha256', accessSecret)
      .update(randomPart)
      .digest('hex')
      .slice(0, 6)
      .toUpperCase();

    const valid = signaturesMatch(expected, signature);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
