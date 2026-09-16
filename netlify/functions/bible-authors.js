// This runs on Netlify's servers, not in the visitor's browser.
// It holds the real Anthropic API key (set as an Environment Variable in Netlify)
// so it's never visible to anyone using the app.
//
// Given a Bible author's name, returns a fair, historically grounded profile:
// occupation, family background, why their writing was included in Scripture,
// and what's known about how they died — clearly separating what Scripture
// itself records from what comes only from later church tradition or legend.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured with an Anthropic API key yet.' }) };
    }

    const { query } = JSON.parse(event.body || '{}');
    if (!query || !query.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Please type the name of a Bible author.' }) };
    }

    const systemPrompt = `You give a fair, historically grounded profile of a Bible author (someone traditionally credited with writing one or more books of the Bible) — background, occupation, family, and why their writing was included in Scripture. You are careful to separate what Scripture itself says from what comes only from church tradition or later legend, and you say so plainly when something is uncertain or disputed among scholars.

Respond with ONLY valid JSON, no other text, no markdown fences, in this exact shape:
{"name": "...", "testament": "...", "books": "...", "occupation": "...", "family": "...", "highlights": "...", "death": "..."}

- "name": the author's name, properly capitalized.
- "testament": "Old Testament" or "New Testament" (or "Both Testaments" if genuinely applicable).
- "books": which biblical book(s) are traditionally attributed to them, briefly (e.g. "Romans, 1-2 Corinthians, Galatians, and several other epistles").
- "occupation": their trade, role, or profession before or alongside their writing (2-3 sentences).
- "family": what's known about their family background or upbringing (2-3 sentences); say plainly if little or nothing is recorded.
- "highlights": why their writing carries the significance it does — their role in the biblical story and why it was recognized as Scripture (2-4 sentences).
- "death": what's known or traditionally held about how they died, clearly distinguishing Scripture-recorded facts from later church tradition or legend, and saying plainly if it's unknown (2-3 sentences).
- If the name given isn't a recognized Bible author, do your best with the closest reasonable match rather than refusing.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [
          { role: 'user', content: 'Bible author: ' + query.trim() }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Search failed (' + res.status + ').', detail: errText })
      };
    }

    const data = await res.json();
    const raw = data.content.map((b) => b.text || '').join('').trim();
    let cleaned = raw.replace(/```json|```/g, '').trim();

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
      if (!parsed.name) {
        throw new Error('missing fields');
      }
    } catch (e) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Received an unexpected response while searching. Please try again.' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
