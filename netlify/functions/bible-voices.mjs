// This runs on Netlify's servers, not in the visitor's browser.
//
// "Voices across the ages" for Bible Commentary (Premium). Loaded only when the
// person taps the section. Kept short and fast (Haiku, ~10–15 s): names, one line each,
// and the app adds search links so readers can look each person up themselves.
// Gives, for a verse or topic:
//   • voices   — how thinkers through the ages saw it (summaries, never quotes)
//   • scientists — scientists who believed in a Creator, each with an HONEST label
//   • creation — (only for origins topics) evolution stated fairly, then the
//                creationist answer, then why it matters
// The app openly presents a biblical, creationist worldview.

const MODEL = 'claude-haiku-4-5-20251001';   // fast: answers in about 10–15 seconds

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

const INSTRUCTIONS = `You are a research helper for a Christian Bible-study app that openly presents a biblical, creationist worldview. For the verse, passage or topic given, fill in the "voices" tool. Keep every text SHORT — this is a quick reference list with search links, not an essay.

"voices": 8 to 10 real, well-known people who are documented as having taught or written about this theme, spread across these eras, in this order: "Ancient & Early Church", "Medieval", "Reformation", "Modern & Today". Mix the fields: theologians, philosophers, scientists, psychologists, educators and historians. "field" names the field and years, e.g. "historian, 37–100". "view": ONE short sentence (under 25 words) in your own words — never a quote, no quotation marks. If you are not sure what someone held on this theme, leave them out. Secular or non-Christian thinkers are welcome; for them add "response": one short sentence of gracious biblical response. For Christians leave "response" empty.

"scientists": 2 to 3 people from the checked list below whose faith or work connects to this topic. Use the name exactly as listed. "view": one short sentence, own words, no quotation marks.
${SCIENTISTS}
"creation": "relevant" is true ONLY if the topic touches creation, origins, Genesis 1–11, the Flood, the age of the earth, design in nature or human origins. Then "evolution": 1–2 sentences stating the evolutionary view fairly, the way its supporters describe it; "creationist": 2–3 sentences giving the biblical creationist answer; "matters": 1 sentence on why it matters. Otherwise "relevant": false and empty strings.

Tone: warm, honest, respectful to every person named.`;

const TOOL = {
  name: 'voices',
  description: 'Return the quick reference list.',
  input_schema: {
    type: 'object',
    properties: {
      voices: { type: 'array', items: { type: 'object', properties: {
        era: { type: 'string' }, name: { type: 'string' }, field: { type: 'string' }, view: { type: 'string' }, response: { type: 'string' } },
        required: ['era', 'name', 'field', 'view'] } },
      scientists: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, view: { type: 'string' } }, required: ['name', 'view'] } },
      creation: { type: 'object', properties: { relevant: { type: 'boolean' }, evolution: { type: 'string' }, creationist: { type: 'string' }, matters: { type: 'string' } }, required: ['relevant'] }
    },
    required: ['voices', 'scientists', 'creation']
  }
};

// name -> what's in brackets on the checked list (years, field)
const DETAILS = new Map();
SCIENTISTS.split('\n').forEach(line => {
  const m = line.match(/^- ([^(]+?) \(([^)]*)\)/);
  if (m) DETAILS.set(m[1].trim(), m[2].trim());
});

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
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: INSTRUCTIONS, tools: [TOOL], tool_choice: { type: 'tool', name: 'voices' }, messages: [{ role: 'user', content: query }] })
    });
    const data = await res.json().catch(() => ({}));
    clearTimeout(timer);
    if (!res.ok) return { error: 'Could not reach the commentary service (' + res.status + ').' };
    const used = (data.content || []).find(b => b.type === 'tool_use');
    const parsed = used && used.input ? used.input : null;   // the tool always returns well-formed data
    if (!parsed) return { error: 'Received an unexpected response. Please try again.' };
    const str = (v, n) => String(v || '').replace(/[“”"]/g, '').slice(0, n);
    const voices = (Array.isArray(parsed.voices) ? parsed.voices : []).slice(0, 12).map(v => ({
      era: str(v.era, 40), name: str(v.name, 80), role: str(v.field || v.role, 80), view: str(v.view, 300), response: str(v.response, 250)
    })).filter(v => v.name && v.view);
    const scientists = (Array.isArray(parsed.scientists) ? parsed.scientists : []).slice(0, 6).map(v => ({
      name: str(v.name, 80), years: '', field: '', label: '', view: str(v.view, 300)
    })).filter(v => CHECKED.has(v.name)).map(v => ({ ...v, label: CHECKED.get(v.name), years: (DETAILS.get(v.name) || '') }));   // only checked people, with the checked label
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
