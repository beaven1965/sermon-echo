// This runs on Netlify's servers, not in the visitor's browser.
//
// After a visitor comes back from PayMongo's checkout page, index.html
// calls this function with the Checkout Session ID it saved (in the
// browser's sessionStorage) just before sending them to PayMongo.
//
// This function asks PayMongo directly — using our secret key — whether
// that specific session was actually paid. Only if PayMongo confirms the
// payment do we hand back an access code. This stops someone from simply
// typing "?paid=success" into the address bar to get a free code.
//
// The access code itself needs no database: it's a random code plus a
// signature made with a secret only this server knows (ACCESS_CODE_SECRET).
// Anyone can type the code into Settings later — including on a different
// device or a family member's phone — and verify-code.js can check it's
// genuine just by recalculating the signature.

const crypto = require('crypto');

function issueAccessCode(secret) {
  const randomPart = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 hex characters
  const signature = crypto
    .createHmac('sha256', secret)
    .update(randomPart)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  return `SE-${randomPart}-${signature}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const secretKey = process.env.PAYMONGO_SECRET_KEY;
    const accessSecret = process.env.ACCESS_CODE_SECRET;
    if (!secretKey || !accessSecret) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server is missing PAYMONGO_SECRET_KEY or ACCESS_CODE_SECRET as a Netlify environment variable.' })
      };
    }

    const { session_id } = JSON.parse(event.body || '{}');
    if (!session_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing session_id — this browser may not have the payment info saved (e.g. a different tab was used).' }) };
    }

    const res = await fetch(`https://api.paymongo.com/v2/checkout_sessions/${session_id}`, {
      headers: { 'Authorization': 'Basic ' + Buffer.from(secretKey + ':').toString('base64') }
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not confirm this payment with PayMongo (' + res.status + ').', detail: errText }) };
    }

    const data = await res.json();
    const attrs = data && data.data && data.data.attributes;
    const paymentIntentStatus =
      attrs && attrs.payment_intent && attrs.payment_intent.attributes && attrs.payment_intent.attributes.status;
    const hasRecordedPayments = attrs && Array.isArray(attrs.payments) && attrs.payments.length > 0;
    const isPaid = paymentIntentStatus === 'succeeded' || hasRecordedPayments;

    if (!isPaid) {
      return { statusCode: 402, body: JSON.stringify({ error: 'PayMongo has not confirmed this payment yet. Please wait a moment and try again.' }) };
    }

    const code = issueAccessCode(accessSecret);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
