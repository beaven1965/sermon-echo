// This runs on Netlify's servers, not in the visitor's browser.
// It holds the real Anthropic API key (set as an Environment Variable in Netlify)
// so it's never visible to anyone using the app.
//
// Translates a sermon's takeaway, highlight bullets, and full transcript
// into another language, keeping the same structure so the app can just
// swap the displayed text.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured with an Anthropic API key yet.' }) };
    }

    const { transcript, takeaway, bullets, targetLanguage } = JSON.parse(event.body || '{}');
    if (!transcript || !targetLanguage) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing transcript or targetLanguage.' }) };
    }

    const systemPrompt = `You translate a sermon/talk's takeaway, highlight bullets, and full transcript into ${targetLanguage}.
Translate naturally and faithfully — capture the real meaning and tone, not a word-for-word translation. Keep it warm and easy to read aloud, the way a fluent native speaker would say it. Keep names of people, places, and Bible book names in their standard form for ${targetLanguage} (e.g. use the conventional localized name for Bible books/figures if one commonly exists in that language).

If ${targetLanguage} is Cebuano (Bisaya), Ilocano, or another regional Philippine language: write in that language's own actual vocabulary and grammar, NOT in Tagalog/Filipino with a few words swapped. These are genuinely distinct languages, not dialects of Tagalog — a Cebuano or Ilocano speaker should recognize the output as their own language, not as Tagalog. For example, Cebuano uses words like "og" (and), "sa taliwala sa" (between), "nagsulti" (said) rather than Tagalog's "at", "sa pagitan ng", "sinabi"; Ilocano uses words like "ken" (and), "iti nagbaetan" (between), "kinuna" (said) rather than Tagalog equivalents. Do not default to Tagalog phrasing out of caution — commit fully to the target language's real grammar and word choices throughout the whole transcript, not just isolated words.

Respond with ONLY valid JSON, no other text, no markdown fences, in this exact shape:
{"takeaway": "...", "bullets": ["...", "..."], "transcript": "..."}

- "takeaway": the translated takeaway, same number of sentences and same meaning as the original.
- "bullets": the translated bullets, same count and order as the original.
- "transcript": the full transcript translated into ${targetLanguage}, preserving paragraph/sentence flow.

IMPORTANT: Your entire reply must be that one JSON object and nothing else — no preamble, no note about ${targetLanguage} being a regional or lower-resource language, no apology, no explanation before or after. Even if you are less certain about some regional terms in ${targetLanguage}, still do your best full translation rather than commenting on the difficulty or refusing. Your reply must start with { and end with }.`;

    const userContent =
      'Takeaway:\n' + (takeaway || '') +
      '\n\nBullets:\n' + (Array.isArray(bullets) ? bullets.map((b) => '- ' + b).join('\n') : '') +
      '\n\nTranscript:\n' + transcript;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userContent }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Translation failed (' + res.status + ').', detail: errText })
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
      if (!parsed.transcript) throw new Error('missing fields');
      if (!Array.isArray(parsed.bullets)) parsed.bullets = [];
      if (!parsed.takeaway) parsed.takeaway = '';
    } catch (e) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Received an unexpected response while translating. Please try again.' })
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
