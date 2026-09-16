// This runs on Netlify's servers, not in the visitor's browser.
//
// Checks whether an access code is one this server genuinely issued —
// without needing to store a list of every code anywhere. It works
// because every code is "random text + signature", and only this server
// (using ACCESS_CODE_SECRET) can produce a matching signature.
//
// There are two kinds of code:
//   SE-... : the original code shown after a real payment. Always valid
//            forever, exactly as before — no lookup needed.
//   SF-... : a family code created from Settings. Signature-checked the
//            same way, but ALSO checked against Netlify Blobs so it can
//            be turned off later by whoever created it.

const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

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
    connectLambda(event);

    const accessSecret = process.env.ACCESS_CODE_SECRET;
    if (!accessSecret) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server is missing ACCESS_CODE_SECRET as a Netlify environment variable.' }) };
    }

    const { code } = JSON.parse(event.body || '{}');
    const cleaned = (code || '').trim().toUpperCase();
    const match = cleaned.match(/^(SE|SF)-([0-9A-F]{10})-([0-9A-F]{6})$/);

    if (!match) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valid: false }) };
    }

    const [, kind, randomPart, signature] = match;
    const expected = crypto
      .createHmac('sha256', accessSecret)
      .update(randomPart)
      .digest('hex')
      .slice(0, 6)
      .toUpperCase();

    const signatureOk = signaturesMatch(expected, signature);

    if (!signatureOk) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valid: false }) };
    }

    if (kind === 'SE') {
      // Original payment codes: signature alone is enough, same as always.
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valid: true }) };
    }

    // Family (SF-) code: also has to exist and not be turned off.
    const store = getStore('family-codes');
    const record = await store.get(cleaned, { type: 'json' });
    const valid = !!record && record.revoked !== true;

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valid }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
