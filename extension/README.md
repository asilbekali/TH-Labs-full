# TH-Labs Real-Time Dubbing (Chrome extension)

Hear the audio of any tab (a Meet or Zoom web call, a livestream, a video) dubbed
into your language in real time. It dubs what you **hear**, never your
microphone. Backend details: [BACKEND_CONTRACT.md](BACKEND_CONTRACT.md).

## Build and load

Node 20+ and Chrome 116+.

```bash
cd extension
npm install
npm run build          # → dist/
```

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose `extension/dist`.
3. Pin the extension, open a tab that plays audio, click the icon and log in.

After every rebuild, click the reload arrow on the extension's card.

`npm run build:debug` builds with `[th-labs]` debug logs. Tokens and audio are
never logged, even then.

## Package for the Chrome Web Store

```bash
npm run zip            # → th-labs-dubbing.zip (the contents of dist/)
```

## Where to look when debugging

| Context | How to open its console |
|---|---|
| Popup | right-click the popup, **Inspect** |
| Service worker | `chrome://extensions`, the extension card, **service worker** |
| Offscreen audio document | `chrome://extensions`, the extension card, **offscreen.html** (only while dubbing) |

## Layout

```
src/config.ts            URLs and tunables
src/popup/               React popup: login, account, dubbing controls
src/background/          service worker: auth, tab capture, offscreen lifecycle, badge
src/offscreen/           audio: capture, Gemini Live sockets, playback
src/lib/api.ts           REST calls to th-labs.uz/v1
src/lib/auth.ts          token storage and single-flight refresh
src/lib/audio-worklet.ts tab audio → 16 kHz mono Int16, 100 ms blocks
```
