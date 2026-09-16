// This runs on Netlify's servers, not in the visitor's browser.
// It holds the real Anthropic API key (set as an Environment Variable in Netlify)
// so it's never visible to anyone using the app.
//
// Given a Bible story name, writes a short, gentle retelling for young
// children (ages 4-8) broken into exactly 4 comic-book panels, plus a
// simple image description per panel for the illustration step.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured with an Anthropic API key yet.' }) };
    }

    const { story } = JSON.parse(event.body || '{}');
    if (!story || !story.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Please choose a story.' }) };
    }

    const systemPrompt = `You write short, warm, simple retellings of Bible stories for young children (ages 4-8), broken into exactly 4 comic-book panels. Keep language simple, gentle, and age-appropriate. For stories that involve danger or violence, soften it for young children without changing the truth of the story (e.g. describe peril and God's protection or deliverance, rather than graphic detail). End with one short, encouraging lesson a child can understand and apply.

For each panel, also write a short, vivid scene description (1-2 sentences, under 250 characters) for a children's storybook-comic illustration: describe the characters, setting, action, and mood clearly enough for an artist to draw it. Do not describe any words or lettering appearing in the image itself.

Respond with ONLY valid JSON, no other text, no markdown fences, in this exact shape:
{"title": "...", "panels": [{"caption": "...", "scene": "..."}, {"caption": "...", "scene": "..."}, {"caption": "...", "scene": "..."}, {"caption": "...", "scene": "..."}], "lesson": "..."}

There must be exactly 4 entries in "panels", telling the story in order from beginning to end.`;

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
          { role: 'user', content: 'Bible story: ' + story.trim() }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Story request failed (' + res.status + ').', detail: errText })
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
      if (!Array.isArray(parsed.panels) || parsed.panels.length === 0) {
        throw new Error('missing fields');
      }
    } catch (e) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Received an unexpected response while writing the story. Please try again.' })
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
