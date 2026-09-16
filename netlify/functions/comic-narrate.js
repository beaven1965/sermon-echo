// This runs on Netlify's servers, not in the visitor's browser.
// It holds the real OpenAI API key (the same one already used for
// transcription and illustration) as a Netlify Environment Variable, so
// it's never visible to anyone using the app.
//
// Given one comic panel's caption text, generates a spoken narration clip
// and returns it as a data URL. Uses OpenAI's older, stable "tts-1" model
// on purpose — narration is a nice-to-have, so reliability matters more
// than picking the newest voice model. If this ever needs a different
// voice, only the "voice" value below needs to change.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured with an OpenAI API key yet.' }) };
    }

    const { text } = JSON.parse(event.body || '{}');
    if (!text || !text.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing narration text.' }) };
    }

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'alloy',
        input: text.trim().slice(0, 2000),
        response_format: 'mp3'
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Narration failed (' + res.status + ').', detail: errText })
      };
    }

    const arrayBuffer = await res.arrayBuffer();
    const b64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: 'data:audio/mpeg;base64,' + b64 })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
