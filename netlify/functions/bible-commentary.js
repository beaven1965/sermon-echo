// This runs on Netlify's servers, not in the visitor's browser.
// It holds the real Anthropic API key (set as an Environment Variable
// in Netlify) so it's never visible to anyone using the app.
//
// Given a Bible verse, passage, or topic, returns a short commentary:
// historical/literary context, what it means, and how to apply it.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured with an Anthropic API key yet.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const query = (body.query || '').trim();
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Please provide a verse, passage, or topic to look up.' }) };
    }

    const systemPrompt = `You are a careful, denominationally-neutral Bible commentary assistant for a church tool called Sermon Recorder. Given a Bible reference or topic, respond with ONLY a JSON object (no markdown, no code fences, no extra text) in this exact shape:
{
  "reference": "the verse, passage, or topic as best identified (e.g. 'John 3:16' or 'The Beatitudes, Matthew 5:1-12')",
  "context": "2-4 sentences of historical and literary context — who wrote it, to whom, and why it matters in its setting",
  "meaning": "2-4 sentences explaining what the passage actually says and means, in plain language",
  "application": "2-3 sentences of practical, non-denominational application a preacher or reader could use today"
}
Keep the tone warm, honest, and useful for sermon preparation. If the input is unclear or not a real Bible reference/topic, do your best reasonable interpretation rather than refusing.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: query }]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not reach the commentary service (' + res.status + ').', detail: errText }) };
    }

    const data = await res.json();
    const raw = (data.content || []).map(b => b.text || '').join('').trim();
    const cleaned = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Received an unexpected response. Please try again.' }) };
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
