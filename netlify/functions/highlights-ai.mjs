// This runs on Netlify's servers, not in the visitor's browser.
//
// ✨ Highlights AI (Premium): translates ONLY the highlight bullets of a recording.
// Each Premium code gets 5 translations per calendar month (Philippine time);
// the count is kept here on the server, so it can't be reset from the phone.
// Listening to a translation (narrate-summary) is included with each use.
// When the 5 are used, bought refills (buy-refill.mjs, kept as 'extra:<code>') are used next.
//   { action: 'status', code }                      -> { used, limit, left }
//   { action: 'translate', code, bullets, language } -> { bullets, used, limit, left }
// Needs ANTHROPIC_API_KEY and ACCESS_CODE_SECRET as Netlify environment variables.

import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const MONTHLY_LIMIT = 5;
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
const monthKey = (code) => code + ':' + new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);   // e.g. SE-...:2026-10

    const regionalExemplars = {
  'cebuano (bisaya)': `Worked examples of genuine Cebuano (Bisaya) — study the vocabulary and sentence patterns, they are NOT Tagalog:
- "She denied any connection between the two investigations." → "Gilalis niya ang bisan unsang koneksyon tali sa duha ka imbestigasyon."
- "He said his office works independently of his wife's role." → "Miingon siya nga ang iyang opisina naglihok nga independente sa tahas sa iyang asawa."
- "She promised full cooperation with local investigations." → "Misaad siya og bug-os nga kooperasyon sa lokal nga mga imbestigasyon."
- "This is the day the Lord has made." → "Kini ang adlaw nga gibuhat sa Ginoo."
Notice: "tali sa" (between/among) not "sa pagitan ng"; "og"/"ug" (and) not "at"; "niya/siya" placement and verb-first sentence order; "mga" for plurals like Tagalog but very different verbs and connectors ("nga" not "na/ng" in most places).`,
  'ilocano': `Worked examples of genuine Ilocano — study the vocabulary and sentence patterns, they are NOT Tagalog:
- "She denied any connection between the two investigations." → "Inlibakna ti aniaman a koneksion iti nagbaetan ti dua nga imbestigasion."
- "He said his office works independently of his wife's role." → "Kinunana a ti opisinana ket agtrabaho a sibubukel manipud iti akem ti asawana."
- "She promised full cooperation with local investigations." → "Nangipatulod isuna iti naan-anay a kooperasion kadagiti lokal nga imbestigasion."
- "This is the day the Lord has made." → "Daytoy ti aldaw nga inaramid ti Apo."
Notice: "iti nagbaetan" (between/among) not "sa pagitan ng"; "ken" (and) not "at"; "ti/iti" articles instead of "ang/ng/sa"; "kinunana", "nangipatulod" verb forms instead of Tagalog "sinabi niya", "nangako siya".`
};

async function translateBullets(bullets, language){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Server is not configured with an Anthropic API key yet.' };
  const langKey = language.trim().toLowerCase();
  const exemplarBlock = regionalExemplars[langKey] ? '\n\n' + regionalExemplars[langKey] : '';
  const system = `You translate the highlight bullet points of a sermon or talk into ${language}.
Translate naturally and faithfully — the real meaning and tone, warm and easy to read aloud, the way a fluent native speaker would say it. Keep names of people, places and Bible books in their usual form for ${language}.
If ${language} is a regional Philippine language (Cebuano, Ilocano, Hiligaynon, Bikol, Waray, Kapampangan, Pangasinan), write in that language's own vocabulary and grammar — NOT Tagalog with a few words swapped.${exemplarBlock}
Reply with ONLY this JSON and nothing else: {"bullets": ["...", "..."]} — the same number of bullets, in the same order.`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 50000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: abort.signal,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 2000, system,
        messages: [{ role: 'user', content: bullets.map(b => '- ' + b).join('\n') }] })
    });
    clearTimeout(timer);
    if (!res.ok) return { error: 'Translation failed (' + res.status + '). Please try again.' };
    const data = await res.json();
    const raw = (data.content || []).map(b => b.text || '').join('');
    let parsed = null;
    try { parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch (e) {}
    const out = parsed && Array.isArray(parsed.bullets) ? parsed.bullets.map(b => String(b || '').trim()).filter(Boolean) : [];
    if (!out.length) return { error: 'Received an unexpected response. Please try again.' };
    return { bullets: out };
  } catch (e) {
    clearTimeout(timer);
    return { error: abort.signal.aborted ? 'This took too long. Please try again.' : 'Could not translate right now. Please try again.' };
  }
}

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  const secret = process.env.ACCESS_CODE_SECRET;
  if (!secret) return json({ error: 'Premium is not set up on the server yet.' });
  const body = await req.json().catch(() => null) || {};
  const code = String(body.code || '').trim().toUpperCase();
  const checked = await checkCode(code, secret);
  if (!checked.valid) {
    return json({ error: checked.reason === 'expired'
      ? 'Your Premium code has expired. Please renew to use AI translation.'
      : 'AI translation is a Premium feature. Your access code could not be confirmed.' });
  }
  const pool = checked.owner || code;          // family members share the payer's AI uses
  const store = getStore('highlights-ai');
  const key = monthKey(pool);
  const used = Number(await store.get(key)) || 0;
  const extraKey = 'extra:' + pool;
  const extraNow = Number(await store.get(extraKey)) || 0;
  const status = (u, ex) => ({ used: u, limit: MONTHLY_LIMIT, extra: ex, left: Math.max(0, MONTHLY_LIMIT - u) + ex });

  if (body.action === 'status') return json(status(used, extraNow));

  const bullets = (Array.isArray(body.bullets) ? body.bullets : []).map(b => String(b || '').slice(0, 600)).filter(Boolean).slice(0, 15);
  const language = String(body.language || '').trim().slice(0, 40);
  if (!bullets.length || !language) return json({ error: 'There are no highlights to translate yet.' });
  if (used >= MONTHLY_LIMIT && extraNow <= 0) {
    return json({ ...status(used, 0), canRefill: true, error: "You've used all " + MONTHLY_LIMIT + ' AI highlight translations for this month. They reset on the 1st of next month, or you can buy 5 more now. Translations you already made stay saved.' });
  }

  // Stream the answer (Netlify allows a streaming reply up to 60 seconds).
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller){
      controller.enqueue(enc.encode(' '));
      const keep = setInterval(() => controller.enqueue(enc.encode(' ')), 3000);
      const result = await translateBullets(bullets, language);
      clearInterval(keep);
      let reply = result;
      if (!result.error) {
        let monthUsed = Number(await store.get(key)) || 0;
        let extra = Number(await store.get(extraKey)) || 0;
        if (monthUsed < MONTHLY_LIMIT) { monthUsed += 1; await store.set(key, String(monthUsed)); }
        else { extra = Math.max(0, extra - 1); await store.set(extraKey, String(extra)); }   // use a bought refill
        reply = { bullets: result.bullets, ...status(monthUsed, extra) };
      }
      controller.enqueue(enc.encode(JSON.stringify(reply)));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
};
