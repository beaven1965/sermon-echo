// This runs on Netlify's servers, not in the visitor's browser.
// It holds the real Anthropic API key (set as an Environment Variable in Netlify)
// so it's never visible to anyone using the app.
//
// Given a topic (e.g. "love", "patience", "courage"), returns a short list of
// quotable lines: a mix of Bible verses and sayings from long-established,
// public-domain philosophers/thinkers — kept short and clearly attributed so
// they're safe to reuse in slides, bulletins, or social posts.

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
      return { statusCode: 400, body: JSON.stringify({ error: 'Please type a topic to search for.' }) };
    }

    const systemPrompt = `You produce short, quotable lines on a given topic for a church sermon app.
Return a mix of:
- 2-3 short Bible verses (any well-known translation, referenced by book/chapter/verse)
- 2-3 short sayings from long-established, public-domain philosophers, theologians, or thinkers who died more than 70 years ago (for example: Aristotle, Marcus Aurelius, Augustine, Aquinas, Pascal, Kierkegaard, C.S. Lewis-era or earlier). Do NOT use any living author or anyone who died recently.
Each quote must be ONE short sentence or a few words — genuinely quotable, not a long passage.

Respond with ONLY valid JSON, no other text, no markdown fences, in this exact shape:
{"intro": "a one-sentence friendly intro naming the topic", "quotes": [{"quote": "the short quote text, no surrounding quotation marks", "source": "attribution, e.g. 'Romans 15:13' or 'Marcus Aurelius'"}]}

- Include at least 4 and at most 6 quotes total.
- If the topic given is unusual, do your best with the closest reasonable match rather than refusing.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
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
      if (!Array.isArray(parsed.quotes) || parsed.quotes.length === 0) {
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
