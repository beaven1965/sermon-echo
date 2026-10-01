// This runs on Netlify's servers, not in the visitor's browser.
//
// "Voices & worldview" for Bible Commentary (Premium). Loaded only when the
// person taps the section, so a normal lookup costs the same as before.
// Gives, for a verse or topic:
//   • voices   — how thinkers through the ages saw it (summaries, never quotes)
//   • scientists — scientists who believed in a Creator, each with an HONEST label
//   • creation — (only for origins topics) evolution stated fairly, then the
//                creationist answer, then why it matters
// The app openly presents a biblical, creationist worldview.

const MODEL = 'claude-sonnet-5';

const SCIENTISTS = `
Use ONLY people from this checked list, with the label EXACTLY as written (the labels are honest — never make anyone sound more creationist than they were):
Ancient
- Aristotle (384–322 BC, philosopher-naturalist) — label: "Argued for a First Cause"
- Galen (129–c.216, physician) — label: "Saw purposeful design in the body"
Medieval
- Robert Grosseteste (c.1175–1253, scientist and bishop) — label: "Believed in a Creator"
- Albertus Magnus (c.1200–1280, naturalist and theologian) — label: "Believed in a Creator"
- Roger Bacon (c.1220–1292, pioneer of experimental science) — label: "Believed in a Creator"
- Nicole Oresme (c.1320–1382, mathematician and bishop) — label: "Believed in a Creator"
Scientific revolution
- Nicolaus Copernicus (1473–1543, astronomer) — label: "Believed in a Creator"
- Johannes Kepler (1571–1630, astronomer) — label: "Believed in a Creator"
- Galileo Galilei (1564–1642, astronomer and physicist) — label: "Believed in a Creator"
- Blaise Pascal (1623–1662, mathematician and physicist) — label: "Believed in a Creator"
- Robert Boyle (1627–1691, founder of modern chemistry) — label: "Believed in a Creator"
- Isaac Newton (1643–1727, physicist and mathematician) — label: "Believed in a Creator"
- John Ray (1627–1705, naturalist) — label: "Saw design in living things"
- Carl Linnaeus (1707–1778, botanist, father of taxonomy) — label: "Believed in a Creator"
19th century
- Michael Faraday (1791–1867, physicist and chemist) — label: "Believed in a Creator"
- Louis Agassiz (1807–1873, naturalist) — label: "Opposed Darwin's theory"
- Gregor Mendel (1822–1884, founder of genetics, Augustinian friar) — label: "Believed in a Creator"
- Louis Pasteur (1822–1895, microbiologist; disproved spontaneous generation) — label: "Believed in a Creator"
- Lord Kelvin (1824–1907, physicist) — label: "Believed in a Creator"
- James Clerk Maxwell (1831–1879, physicist) — label: "Believed in a Creator"
- George Washington Carver (c.1864–1943, agricultural scientist) — label: "Believed in a Creator"
20th century
- Max Planck (1858–1947, physicist, founder of quantum theory) — label: "Believed in God"
- Arthur Compton (1892–1962, physicist) — label: "Believed in a Creator"
- Georges Lemaître (1894–1966, physicist and priest; proposed the Big Bang) — label: "Believed in a Creator"
- Wernher von Braun (1912–1977, rocket engineer) — label: "Argued for design in nature"
Today
- Raymond Damadian (1936–2022, inventor of the MRI scanner) — label: "Young-earth creationist"
- John Sanford (plant geneticist, co-inventor of the gene gun) — label: "Young-earth creationist"
- Andrew Snelling (geologist) — label: "Young-earth creationist"
- Henry Morris (1918–2006, hydraulic engineer, founder of modern creation science) — label: "Young-earth creationist"
- Michael Behe (biochemist) — label: "Intelligent design (accepts common descent)"
- Stephen Meyer (philosopher of science) — label: "Intelligent design"
- James Tour (synthetic chemist) — label: "Christian; critic of origin-of-life claims"
- John Lennox (mathematician) — label: "Christian; critic of naturalism"
- Francis Collins (geneticist, led the Human Genome Project) — label: "Believes in a Creator; accepts evolution"
- Antony Flew (1923–2010, philosopher; former leading atheist) — label: "Came to believe in a Creator"
`;

const INSTRUCTIONS = `You are a research helper for a Christian Bible-study app that openly presents a biblical, creationist worldview. For the verse, passage or topic given, return ONLY a JSON object (no markdown, no code fences, no other text) in this shape:
{
  "voices": [ { "era": "Ancient & Early Church", "name": "Augustine of Hippo", "role": "theologian, 354–430", "view": "…", "response": "" } ],
  "scientists": [ { "name": "Isaac Newton", "years": "1643–1727", "field": "physicist and mathematician", "label": "Believed in a Creator", "view": "…" } ],
  "creation": { "relevant": false, "evolution": "", "creationist": "", "matters": "" }
}

"voices": 8 to 12 thinkers who really wrote or taught about this verse or theme, spread across these eras, in this order: "Ancient & Early Church", "Medieval", "Reformation", "Modern & Today". Include a mix of theologians, philosophers, scientists, psychologists, educators and historians — as many of these fields as genuinely addressed the theme — and make "role" name the field (e.g. "historian, 37–100"). You may include secular or non-Christian thinkers; for them, fill "response" with 1–2 sentences of a gracious biblical response. For Christian thinkers leave "response" as "".
- "view": 1–2 sentences summarizing that person's known view IN YOUR OWN WORDS. NEVER use quotation marks and NEVER present words as a direct quote. Only include real, well-known people whose view on this theme is documented in their writings; if you are not sure what someone held, leave them out. Include the people most relevant to the topic rather than always the same names.

"scientists": 3 to 5 people chosen from the checked list below — prefer those whose work or beliefs connect to this topic. Use their name, years, field and label exactly as listed. "view": 1–2 sentences, in your own words, about their faith or view of creation and, if possible, how it relates to this topic. No quotation marks.
${SCIENTISTS}
"creation": set "relevant": true ONLY if the topic touches creation, origins, Genesis 1–11, the Flood, the age of the earth, design in nature, or human origins. Then:
- "evolution": 2–3 sentences stating the evolutionary view honestly and accurately, the way its own supporters would describe it.
- "creationist": 3–5 sentences giving the biblical creationist answer — Scripture first, then scientific and logical reasons. Respectful, never mocking.
- "matters": 1–2 sentences on why this matters for faith and life.
If not relevant, return "relevant": false with empty strings.

Tone: warm, honest, respectful to every person named.`;

// name -> checked label, read from the list above
const CHECKED = new Map();
SCIENTISTS.split('\n').forEach(line => {
  const m = line.match(/^- ([^(]+?) \(.*label: "([^"]+)"/);
  if (m) CHECKED.set(m[1].trim(), m[2]);
});

async function getVoices(query, deadline){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Server is not configured with an Anthropic API key yet.' };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(5000, deadline - Date.now()));
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: abort.signal,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 3500, system: INSTRUCTIONS, messages: [{ role: 'user', content: query }] })
    });
    const data = await res.json().catch(() => ({}));
    clearTimeout(timer);
    if (!res.ok) return { error: 'Could not reach the commentary service (' + res.status + ').' };
    const raw = (data.content || []).map(b => b.text || '').join('');
    let parsed = null;
    try { parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch (e) {}
    if (!parsed) return { error: 'Received an unexpected response. Please try again.' };
    const str = (v, n) => String(v || '').replace(/[“”"]/g, '').slice(0, n);
    const voices = (Array.isArray(parsed.voices) ? parsed.voices : []).slice(0, 12).map(v => ({
      era: str(v.era, 40), name: str(v.name, 80), role: str(v.role, 80), view: str(v.view, 600), response: str(v.response, 400)
    })).filter(v => v.name && v.view);
    const scientists = (Array.isArray(parsed.scientists) ? parsed.scientists : []).slice(0, 6).map(v => ({
      name: str(v.name, 80), years: str(v.years, 30), field: str(v.field, 120), label: str(v.label, 60), view: str(v.view, 500)
    })).filter(v => CHECKED.has(v.name)).map(v => ({ ...v, label: CHECKED.get(v.name) }));   // only checked people, with the checked label
    const c = parsed.creation || {};
    const creation = c.relevant === true
      ? { relevant: true, evolution: str(c.evolution, 900), creationist: str(c.creationist, 1400), matters: str(c.matters, 500) }
      : { relevant: false };
    return { voices, scientists, creation };
  } catch (err) {
    clearTimeout(timer);
    return { error: abort.signal.aborted ? 'This took too long. Please try again.' : 'Could not load right now. Please try again.' };
  }
}

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  const body = await req.json().catch(() => null) || {};
  const query = String(body.query || '').trim().slice(0, 200);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller){
      const started = Date.now();
      controller.enqueue(enc.encode(' '));
      const keep = setInterval(() => controller.enqueue(enc.encode(' ')), 3000);
      const result = query ? await getVoices(query, started + 52000) : { error: 'Please search a verse or topic first.' };
      clearInterval(keep);
      controller.enqueue(enc.encode(JSON.stringify(result)));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
};
