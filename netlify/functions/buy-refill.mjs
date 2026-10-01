// This runs on Netlify's servers, not in the visitor's browser.
//
// 🎟 Refill: a Premium user who has used their 5 monthly AI uses can buy 5 more
// for ₱50 through PayMongo (GCash, card, QR Ph). Bought uses don't vanish on the
// 1st — they stay until the Premium code itself expires.
//   { action: 'start', code }        -> { checkout_url, session_id }
//   { action: 'confirm', session_id } -> { added, extra }   (safe to call twice)
// Needs PAYMONGO_SECRET_KEY and ACCESS_CODE_SECRET as Netlify environment variables.

import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const REFILL_PRICE_PESOS = 50;   // ← change the price here
const REFILL_USES = 5;           // ← uses added per refill
const LISTENS_PER_USE = 2;       // AI-voice listens that come with each use
const OLD_FORMAT_CUTOFF_MS = new Date('2026-09-30T00:00:00+08:00').getTime();

const sig6 = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex').slice(0, 6).toUpperCase();
function same(a, b){ const A = Buffer.from(a), B = Buffer.from(b); return A.length === B.length && crypto.timingSafeEqual(A, B); }

// Same rules as verify-code.js.
async function checkCode(code, secret){
  const c = String(code || '').trim().toUpperCase();
  let m = c.match(/^SE-([0-9A-F]{10})-([0-9A-F]{8})-([0-9A-F]{6})$/);
  if (m) {
    if (!same(sig6(secret, m[1] + m[2]), m[3])) return { valid: false, reason: 'invalid' };
    return Date.now() < parseInt(m[2], 16) * 1000 ? { valid: true, owner: c } : { valid: false, reason: 'expired' };
  }
  m = c.match(/^SE-([0-9A-F]{10})-([0-9A-F]{6})$/);
  if (m) {
    if (!same(sig6(secret, m[1]), m[2])) return { valid: false, reason: 'invalid' };
    return Date.now() < OLD_FORMAT_CUTOFF_MS ? { valid: true, owner: c } : { valid: false, reason: 'expired' };
  }
  m = c.match(/^SF-([0-9A-F]{10})-([0-9A-F]{6})$/);
  if (m) {
    if (!same(sig6(secret, m[1]), m[2])) return { valid: false, reason: 'invalid' };
    const rec = await getStore('family-codes').get(c, { type: 'json' });
    if (!rec || rec.revoked === true) return { valid: false, reason: 'invalid' };
    const owner = String(rec.ownerCode || '');
    const om = owner.match(/^SE-[0-9A-F]{10}-([0-9A-F]{8})-[0-9A-F]{6}$/);
    const ownerExpiresMs = om ? parseInt(om[1], 16) * 1000 : OLD_FORMAT_CUTOFF_MS;
    return Date.now() < ownerExpiresMs ? { valid: true, owner } : { valid: false, reason: 'expired' };   // family shares the payer's AI uses
  }
  return { valid: false, reason: 'invalid' };
}



const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  const payKey = process.env.PAYMONGO_SECRET_KEY;
  const secret = process.env.ACCESS_CODE_SECRET;
  if (!payKey || !secret) return json({ error: 'Payments are not set up on the server yet.' });
  const auth = 'Basic ' + Buffer.from(payKey + ':').toString('base64');
  const body = await req.json().catch(() => null) || {};
  const refills = getStore('refills');

  if (body.action === 'start') {
    const code = String(body.code || '').trim().toUpperCase();
    const checked = await checkCode(code, secret);
    if (!checked.valid) return json({ error: checked.reason === 'expired' ? 'Your Premium code has expired. Please renew Premium first.' : 'Your Premium code could not be confirmed.' });
    const origin = req.headers.get('origin') || new URL(req.url).origin;
    const res = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
      method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { attributes: {
        line_items: [{ name: 'Sermon Echo — ' + REFILL_USES + ' more AI uses', amount: REFILL_PRICE_PESOS * 100, currency: 'PHP', quantity: 1 }],
        payment_method_types: ['card', 'gcash', 'qrph'],
        success_url: origin + '/?refill=success',
        cancel_url: origin + '/?refill=cancelled',
        description: REFILL_USES + ' more AI translations of highlights (with AI narration)',
        send_email_receipt: true,
        metadata: { code }
      } } })
    });
    const data = await res.json().catch(() => ({}));
    const id = data && data.data && data.data.id;
    const url = data && data.data && data.data.attributes && data.data.attributes.checkout_url;
    if (!res.ok || !id || !url) return json({ error: 'Could not start the payment page right now. Please try again.' });
    await refills.setJSON('pending:' + id, { code: checked.owner || code, at: new Date().toISOString() });   // refills go to the payer's shared pool
    return json({ checkout_url: url, session_id: id });
  }

  if (body.action === 'confirm') {
    const id = String(body.session_id || '').trim();
    if (!/^[A-Za-z0-9_]{6,80}$/.test(id)) return json({ error: 'Missing payment information on this device.' });
    const done = await refills.get('done:' + id, { type: 'json' });
    const ai = getStore('highlights-ai');
    if (done) return json({ added: 0, alreadyAdded: true, extra: Number(await ai.get('extra:' + done.code)) || 0 });
    const pending = await refills.get('pending:' + id, { type: 'json' });
    if (!pending || !pending.code) return json({ error: 'This payment was not started from this app.' });
    const res = await fetch('https://api.paymongo.com/v2/checkout_sessions/' + id, { headers: { 'Authorization': auth } });
    const data = await res.json().catch(() => ({}));
    const a = data && data.data && data.data.attributes;
    const status = a && a.payment_intent && a.payment_intent.attributes && a.payment_intent.attributes.status;
    const paid = status === 'succeeded' || (a && Array.isArray(a.payments) && a.payments.length > 0);
    if (!res.ok || !paid) return json({ error: 'PayMongo has not confirmed this payment yet. Please wait a moment and reopen the app.' });
    await refills.setJSON('done:' + id, { code: pending.code, at: new Date().toISOString() });   // mark first, so it can never be added twice
    const extra = (Number(await ai.get('extra:' + pending.code)) || 0) + REFILL_USES;
    await ai.set('extra:' + pending.code, String(extra));
    const bonus = (Number(await ai.get('listen-bonus:' + pending.code)) || 0) + REFILL_USES * LISTENS_PER_USE;
    await ai.set('listen-bonus:' + pending.code, String(bonus));
    return json({ added: REFILL_USES, extra });
  }

  return json({ error: 'Unknown request.' });
};
