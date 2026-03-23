const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.GEMINI_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_KEY not set in environment variables' });

  // Fix: safe destructure with fallback
  const body = req.body || {};
  const system = typeof body.system === 'string' ? body.system : '';
  const user = typeof body.user === 'string' ? body.user.trim() : '';
  const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : 1400;

  if (!user) return res.status(400).json({ error: 'Missing required field: user' });

  const fullPrompt = system ? `${system}\n\n${user}` : user;

  const payload = JSON.stringify({
    contents: [{ parts: [{ text: fullPrompt }] }],
    generationConfig: { maxOutputTokens: maxTokens }
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const result = JSON.parse(data);

          if (result.error) {
            res.status(400).json({ error: result.error.message });
            return resolve();
          }

          // Fix: handle safety blocks and empty candidates
          const candidate = result.candidates?.[0];
          if (!candidate) {
            res.status(500).json({ error: 'No response from AI. Try rephrasing your input.' });
            return resolve();
          }

          if (candidate.finishReason === 'SAFETY') {
            res.status(400).json({ error: 'Response blocked by safety filter. Try rephrasing.' });
            return resolve();
          }

          const parts = candidate.content?.parts || [];
const text = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
          if (!text) {
            res.status(500).json({ error: 'Empty response from AI. Try again.' });
            return resolve();
          }

          res.status(200).json({ text });
          resolve();

        } catch (e) {
          res.status(500).json({ error: 'Failed to parse AI response: ' + e.message });
          resolve();
        }
      });
    });

    request.on('error', (err) => {
      res.status(500).json({ error: 'Network error: ' + err.message });
      resolve();
    });

    request.write(payload);
    request.end();
  });
};