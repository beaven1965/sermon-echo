// This runs on Netlify's servers, not in the visitor's browser.
// It holds the real Anthropic API key (set as an Environment Variable
// in Netlify) so it's never visible to anyone using the app.
//
// Given a Biblical name, returns where that person fits in the
// genealogical line from Adam down to Jesus.

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
      return { statusCode: 400, body: JSON.stringify({ error: 'Please type a Biblical name to search.' }) };
    }

    const systemPrompt = `You are a careful Bible genealogy assistant for a church tool called Sermon Recorder, tracing the line from Adam to Jesus (drawing on Genesis, 1 Chronicles, and the genealogies in Matthew 1 and Luke 3). Given a name, respond with ONLY a JSON object (no markdown, no code fences, no extra text) in this exact shape:
{
  "name": "the person's name as best identified",
  "generation": "a short description of where they fall in the line, e.g. '10th generation from Adam' or 'in the royal line through David'",
  "father": "their father's name, if known from Scripture, else a brief honest note that it isn't specified",
  "note": "2-4 sentences on who they were and how they connect toward Jesus' genealogy",
  "lineageSnippet": ["a short array of 6-10 names showing a few generations before and after this person in the Adam-to-Jesus line, in order"]
}
Be honest when Scripture is silent or when genealogies differ between sources (e.g. Matthew vs Luke) rather than inventing certainty. If the name given isn't part of Jesus' genealogical line at all, say so plainly in "note" and give their general Biblical era in "generation" instead.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: 'user', content: query }]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not reach the genealogy service (' + res.status + ').', detail: errText }) };
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
