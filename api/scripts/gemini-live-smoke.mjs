#!/usr/bin/env node
// Smoke test for Gemini Live Translate, end to end against the real API.
//
//   node api/scripts/gemini-live-smoke.mjs <pcm16k.raw> [--lang uz] [--ws-url <url>]
//
// <pcm16k.raw> is headerless 16 kHz mono s16le speech, e.g.
//   ffmpeg -i clip.mp4 -t 4 -ac 1 -ar 16000 -f s16le pcm16k.raw
//
// Without --ws-url it mints an ephemeral token itself, the way
// RealtimeService does, from GEMINI_API_KEY (environment, else api/.env).
// With --ws-url it uses one handed out by POST /v1/realtime/session, which is
// how the account API's own output is checked. It never prints the key or the
// token. Costs a fraction of a cent per run.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = process.env.REALTIME_MODEL || 'gemini-3.5-live-translate-preview';
const API = 'https://generativelanguage.googleapis.com';
const WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/' +
  'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const env = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  const line = readFileSync(env, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('GEMINI_API_KEY='));
  if (!line) throw new Error('GEMINI_API_KEY not set (env or api/.env)');
  return line.slice('GEMINI_API_KEY='.length).trim();
}

async function mintToken(lang) {
  const now = Date.now();
  const body = {
    uses: 1,
    expireTime: new Date(now + 330_000).toISOString(),
    newSessionExpireTime: new Date(now + 60_000).toISOString(),
    // REST name for what the SDKs call liveConnectConstraints: the session
    // setup the token is locked to, in the WebSocket `setup` message's shape.
    bidiGenerateContentSetup: {
      model: `models/${MODEL}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: { targetLanguageCode: lang },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
  const res = await fetch(`${API}/v1beta/auth_tokens`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token: HTTP ${res.status} ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  console.log('token: ok, fields:', Object.keys(json).join(','));
  return json.name;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) throw new Error('usage: <pcm16k.raw> [--lang uz] [--ws-url url]');
  const pcm = readFileSync(file);
  const lang = arg('lang', 'uz');
  const wsUrl = arg('ws-url') ?? `${WS_BASE}?access_token=${encodeURIComponent(await mintToken(lang))}`;

  const ws = new WebSocket(wsUrl);
  let audioBytes = 0;
  let input = '';
  let output = '';
  const done = new Promise((resolve) => {
    ws.addEventListener('close', (e) => resolve(`closed ${e.code} ${e.reason}`));
  });

  ws.addEventListener('open', () => {
    console.log('ws: open');
    ws.send(JSON.stringify({ setup: { model: `models/${MODEL}` } }));
  });
  ws.addEventListener('message', async (e) => {
    const raw = typeof e.data === 'string' ? e.data : Buffer.from(await e.data.arrayBuffer()).toString();
    const msg = JSON.parse(raw);
    if (msg.setupComplete) {
      console.log('ws: setupComplete — streaming', (pcm.length / 32000).toFixed(1), 's');
      const chunk = 3200; // 100 ms at 16 kHz s16
      for (let off = 0; off < pcm.length; off += chunk) {
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: { data: pcm.subarray(off, off + chunk).toString('base64'), mimeType: 'audio/pcm;rate=16000' },
          },
        }));
        await new Promise((r) => setTimeout(r, 100));
      }
      // let the translation catch up, then hang up
      setTimeout(() => ws.close(1000, 'done'), 6000);
    }
    const sc = msg.serverContent;
    if (sc?.inputTranscription?.text) input += sc.inputTranscription.text;
    if (sc?.outputTranscription?.text) output += sc.outputTranscription.text;
    for (const p of sc?.modelTurn?.parts ?? []) {
      if (p.inlineData?.data) audioBytes += Buffer.from(p.inlineData.data, 'base64').length;
    }
    const other = Object.keys(msg).filter((k) => !['setupComplete', 'serverContent'].includes(k));
    if (other.length) console.log('ws: other message keys:', other.join(','), JSON.stringify(msg).slice(0, 200));
  });
  ws.addEventListener('error', (e) => console.log('ws: error', e.message ?? ''));

  console.log('ws:', await done);
  console.log('audio bytes received:', audioBytes, `(${(audioBytes / 48000).toFixed(1)} s at 24 kHz)`);
  console.log('heard:', input.trim() || '(none)');
  console.log('translated:', output.trim() || '(none)');
  process.exit(audioBytes > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(2);
});
