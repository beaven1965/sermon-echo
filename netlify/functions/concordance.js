// This runs on Netlify's servers, not in the visitor's browser.
// It holds the real Anthropic API key (set as an Environment Variable in Netlify)
// so it's never visible to anyone using the app.
//
// Given a topic or word, returns a short list of relevant Bible passages —
// like a classic concordance: pointers to where a topic appears in
// Scripture, not the full verse text (so we're not relying on the model
// to recite exact wording, only to point to the right references).

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
      return { statusCode: 400, body: JSON.stringify({ error: 'Please type a word or topic to search for.' }) };
    }

    const systemPrompt = `You act as a Bible concordance: given a topic, word, or phrase, you point to where Scripture addresses it. You do not quote full verse text (only a short, careful paraphrase of what each passage says — never a word-for-word quotation, to avoid misquoting).

Respond with ONLY valid JSON, no other text, no markdown fences, in this exact shape:
{"topic": "...", "intro": "...", "passages": [{"reference": "...", "note": "..."}]}

- "topic": the topic restated plainly, 2-5 words.
- "intro": 1-2 sentences giving a fair, general overview of how Scripture addresses this topic overall (both Old and New Testament where relevant). Neutral, non-denominational tone.
- "passages": 6-10 relevant Bible references (book chapter:verse or verse range, e.g. "Philippians 4:6-7"), spread across both testaments where genuinely relevant — don't force an Old Testament or New Testament reference if none fits well. Order them in a sensible reading progression (not necessarily biblical book order). For each, "note" is one short sentence (in your own words, not a quotation) on what that passage says about the topic.
- If the query isn't a recognizable topic or word Scripture meaningfully addresses, still do your best with the closest reasonable interpretation — don't refuse.`;

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
        body: JSON.stringify({ error: 'Concordance search failed (' + res.status + ').', detail: errText })
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
      if (!Array.isArray(parsed.passages) || parsed.passages.length === 0) {
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
