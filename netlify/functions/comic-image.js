// This runs on Netlify's servers, not in the visitor's browser.
// It holds the real OpenAI API key (the same one already used for
// transcription) as a Netlify Environment Variable, so it's never visible
// to anyone using the app.
//
// Given one comic panel's scene description, generates a single
// children's-storybook-style illustration and returns it as a data URL.
// Uses DALL-E 2 at 512x512: smaller, faster, and cheaper than DALL-E 3,
// which keeps this well within Netlify's response-size and time limits
// for a cartoon-style illustration like this.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured with an OpenAI API key yet.' }) };
    }

    const { scene } = JSON.parse(event.body || '{}');
    if (!scene || !scene.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing scene description.' }) };
    }

    const stylePrefix = "Children's Bible storybook comic-panel illustration, warm and gentle, colorful flat cartoon style, friendly faces, no text or lettering anywhere in the image: ";
    const prompt = (stylePrefix + scene.trim()).slice(0, 1000);

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'dall-e-2',
        prompt: prompt,
        n: 1,
        size: '512x512',
        response_format: 'b64_json'
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Illustration failed (' + res.status + ').', detail: errText })
      };
    }

    const data = await res.json();
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) {
      return { statusCode: 502, body: JSON.stringify({ error: 'No image was returned. Please try again.' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: 'data:image/png;base64,' + b64 })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
