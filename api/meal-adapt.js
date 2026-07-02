// ============================================================
// POST /api/meal-adapt
// Body: { meal, context, targetKcal, targetProtein }
// Rebuilds a planned meal around the ingredients the user says
// they have (e.g. "100 g Transparent Labs mass gainer"), keeping
// the per-meal calorie/protein targets. Uses the Anthropic API
// server-side so no key ships to the browser.
// Env var required on Vercel:
//   ANTHROPIC_API_KEY
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'not_configured' });

  const { meal, context, targetKcal, targetProtein } = req.body || {};
  if (!context || typeof context !== 'string') {
    return res.status(400).json({ error: 'missing_context' });
  }

  const prompt =
    'You plan meals for a fitness dashboard (goal: muscle growth with fat loss, high energy and focus).\n' +
    'Rebuild the meal below around what the user says they have available.\n\n' +
    'Rules:\n' +
    '- The user\'s stated ingredients/constraints are the core of the meal — use them as given (brand names and amounts included).\n' +
    '- Every ingredient gets an exact quantity in g or ml.\n' +
    '- Land within ±10% of ' + (Number(targetKcal) || 750) + ' kcal and ' + (Number(targetProtein) || 55) + ' g protein. Fill gaps with simple whole foods.\n' +
    '- One realistic meal someone would actually make, not a list of snacks.\n\n' +
    'Currently planned meal: ' + JSON.stringify(meal || {}) + '\n' +
    'User\'s available ingredients / constraints: "' + context.replace(/"/g, "'") + '"\n\n' +
    'Return ONLY a JSON object, no code fences, no preamble:\n' +
    '{"name": "...", "emoji": "one emoji", "kcal": 0, "p": 0, "c": 0, "f": 0, "ing": ["100 g ...", "..."], "tip": "one short sentence on why this works"}';

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await aiRes.json();
    if (!aiRes.ok) {
      return res.status(502).json({ error: 'anthropic_error', detail: data && data.error && data.error.message });
    }
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      return res.status(502).json({ error: 'bad_ai_response', detail: 'no JSON in AI response' });
    }
    const out = JSON.parse(text.slice(start, end + 1));
    if (!out || typeof out.name !== 'string' || !Array.isArray(out.ing) || out.ing.length === 0) {
      return res.status(502).json({ error: 'bad_ai_response' });
    }
    return res.status(200).json({
      name: out.name,
      emoji: typeof out.emoji === 'string' && out.emoji ? out.emoji : '🍽️',
      kcal: Math.round(Number(out.kcal) || 0),
      p: Math.round(Number(out.p) || 0),
      c: Math.round(Number(out.c) || 0),
      f: Math.round(Number(out.f) || 0),
      ing: out.ing.map(String),
      tip: typeof out.tip === 'string' ? out.tip : '',
    });
  } catch (e) {
    return res.status(502).json({ error: 'adapt_failed' });
  }
}
