// This runs on Netlify's servers, not in the visitor's browser.
// It holds the real Anthropic API key (set as an Environment Variable in Netlify)
// so it's never visible to anyone using the app.
//
// Given a biblical event, place, or topic, returns a fair, balanced look at
// what archaeology and history have found that bears on it — presenting
// findings honestly rather than overclaiming "proof," and noting where
// scholars are divided.

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
      return { statusCode: 400, body: JSON.stringify({ error: 'Please type a biblical event, place, or topic to search for.' }) };
    }

    const systemPrompt = `You give a fair, balanced look at what archaeology, history, and science have found that bears on a biblical event, place, or topic. You are careful and honest: you present real findings and their significance, but you never overclaim "proof," and you plainly note where the evidence is contested, incomplete, or where serious scholars disagree — including scholars who are skeptical of the biblical account. You do not take an apologetics stance and you do not take a purely skeptical stance; you describe the actual state of evidence and scholarly debate.

Respond with ONLY valid JSON, no other text, no markdown fences, in this exact shape:
{"topic": "...", "claim": "...", "evidence": "...", "perspective": "..."}

- "topic": the topic restated plainly, a few words.
- "claim": what the Bible itself states about this event, place, or topic (2-3 sentences), described neutrally.
- "evidence": specific, real archaeological, historical, or scientific findings relevant to it (2-4 sentences) — cite actual sites, artifacts, texts, or research where genuinely relevant, not vague generalities.
- "perspective": a fair, balanced summary of how scholars view the evidence — where there's reasonable consensus, where it's genuinely disputed, and why reasonable people (both believing and skeptical scholars) can disagree (2-4 sentences). Never claim the evidence definitively "proves" or "disproves" Scripture.
- If the query isn't a recognizable biblical event, place, or topic, do your best with the closest reasonable interpretation — don't refuse.`;

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
          { role: 'user', content: 'Topic: ' + query.trim() }
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
      if (!parsed.topic) {
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
