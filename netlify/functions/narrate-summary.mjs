// This runs on Netlify's servers, not in the visitor's browser.
//
// "✨ AI voice" (Premium) — reads the sermon's Takeaway and Highlights aloud
// with OpenAI's voice, which sounds clear in Tagalog and other languages on
// any phone or laptop. Only the short summary is read (never the whole
// transcript) so each listen costs about ₱1. Replaying on the phone is free.
// A code can use it up to 30 times a day, so a leaked code can't run up costs.
// Needs OPENAI_API_KEY and ACCESS_CODE_SECRET as Netlify environment variables.

import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const MAX_CHARS = 2500;
const DAILY_LIMIT = 30;
const OLD_FORMAT_CUTOFF_MS = new Date('2026-09-30T00:00:00+08:00').getTime();

const sig6 = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex').slice(0, 6).toUpperCase();
function same(a, b){ const A = Buffer.from(a), B = Buffer.from(b); return A.length === B.length && crypto.timingSafeEqual(A, B); }

// Same rules as verify-code.js.
async function checkCode(code, secret){
  const c = String(code || '').trim().toUpperCase();
  let m = c.match(/^SE-([0-9A-F]{10})-([0-9A-F]{8})-([0-9A-F]{6})$/);
  if (m) {
    if (!same(sig6(secret, m[1] + m[2]), m[3])) return { valid: false, reason: 'invalid' };
    return Date.now() < parseInt(m[2], 16) * 1000 ? { valid: true } : { valid: false, reason: 'expired' };
  }
  m = c.match(/^SE-([0-9A-F]{10})-([0-9A-F]{6})$/);
  if (m) {
    if (!same(sig6(secret, m[1]), m[2])) return { valid: false, reason: 'invalid' };
    return Date.now() < OLD_FORMAT_CUTOFF_MS ? { valid: true } : { valid: false, reason: 'expired' };
  }
  m = c.match(/^SF-([0-9A-F]{10})-([0-9A-F]{6})$/);
  if (m) {
    if (!same(sig6(secret, m[1]), m[2])) return { valid: false, reason: 'invalid' };
    const rec = await getStore('family-codes').get(c, { type: 'json' });
    return rec && rec.revoked !== true ? { valid: true } : { valid: false, reason: 'invalid' };
  }
  return { valid: false, reason: 'invalid' };
}

const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  const openaiKey = process.env.OPENAI_API_KEY;
  const secret = process.env.ACCESS_CODE_SECRET;
  if (!openaiKey || !secret) return json({ error: 'The AI voice is not set up on the server yet.' });

  const body = await req.json().catch(() => null) || {};
  const code = String(body.code || '').trim().toUpperCase();
  const checked = await checkCode(code, secret);
  if (!checked.valid) {
    return json({ error: checked.reason === 'expired'
      ? 'Your Premium code has expired. Please renew to use the AI voice.'
      : 'The AI voice is a Premium feature. Your access code could not be confirmed.' });
  }
  const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!text) return json({ error: 'There is no takeaway or highlights to read yet.' });

  const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);   // Philippine date
  const daily = getStore('narrate-daily');
  const key = code + ':' + day;
  const used = Number(await daily.get(key)) || 0;
  if (used >= DAILY_LIMIT) return json({ error: "You've used the AI voice " + DAILY_LIMIT + ' times today. It will be available again tomorrow. The phone-voice Listen button still works.' });

  // Stream the answer: Netlify allows a streaming reply up to 60 seconds.
  const stream = new ReadableStream({
    async start(controller){
      try {
        const res = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
          body: JSON.stringify({ model: 'tts-1', voice: 'nova', input: text, response_format: 'mp3' })
        });
        if (res.ok) {
          controller.enqueue(new Uint8Array(await res.arrayBuffer()));
          await daily.set(key, String(used + 1));
        } else {
          console.log('narrate-summary: voice service error', res.status);
        }
      } catch (e) { console.log('narrate-summary: no connection'); }
      controller.close();          // an empty reply means "it didn't work" — the app says so
    }
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
};
