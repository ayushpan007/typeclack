# TypeClack ⌨️

> Realistic mechanical keyboard sounds for VS Code — Cherry MX Blue, Brown & Red switch packs

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/YourPublisherNameHere.typeclack?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=YourPublisherNameHere.typeclack)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/YourPublisherNameHere.typeclack)](https://marketplace.visualstudio.com/items?itemName=YourPublisherNameHere.typeclack)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

TypeClack brings the satisfying clack of a real mechanical keyboard to every keystroke you make in VS Code. Three authentic switch profiles, smart key-type detection, polyphonic audio pooling, and per-key pitch variation — all running inside a hidden Webview so audio latency stays at < 5 ms.

---

## Features

### 🎛️ Three Authentic Switch Profiles

| Profile | Sound Character |
|---------|----------------|
| **Cherry MX Blue** | Crisp, loud tactile click with spring ping — the classic "clicky" switch |
| **Cherry MX Brown** | Softer tactile bump, deeper "thock" — quieter but still satisfying |
| **Cherry MX Red** | Smooth linear — very quiet, just the thud of the key bottoming out |

### 🎹 Four Distinct Key Sounds

Each pack includes individually tuned sounds for:
- **Regular keys** — 3 randomized variants (`key1`, `key2`, `key3`) that cycle naturally
- **Enter** — deeper resonance from the larger stabilizer bar
- **Backspace** — slightly higher pitch (smaller key, shorter travel)
- **Spacebar** — lowest, broadest sound from the long stabilizer

### 🧠 Smart Detection

TypeClack uses VS Code's `onDidChangeTextDocument` API with classification logic that:
- ✅ Plays sounds for real user keystrokes
- ❌ Stays silent during paste, format-on-save, snippets, and auto-imports
- ✅ Supports multi-cursor typing (each cursor plays once per event)
- ❌ Filters output panels, debug consoles, and terminal data streams

### 🔇 Terminal Muting

When `typeClack.muteTerminal` is `true`, sounds pause automatically while the integrated terminal is in focus — so your shell commands don't echo.

### 🎚️ Audio Pool & Polyphony

Up to 8 sounds can play simultaneously via the Web Audio API pool. Fast typists never get cut off — each new keystroke layers on top without interrupting the previous sound.

---

## Installation

### From the VS Code Marketplace
1. Open VS Code
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on Mac)
3. Search for **TypeClack**
4. Click **Install**

### From VSIX (manual)
1. Download the latest `typeclack-x.x.x.vsix` from [Releases](https://github.com/YourUsername/typeclack/releases)
2. In VS Code: Extensions → `···` menu → **Install from VSIX…**
3. Select the file — TypeClack activates automatically

---

## Configuration

Add any of these to your VS Code `settings.json`:

```jsonc
{
  // Master switch
  "typeClack.enabled": true,

  // Volume: 0.0 (silent) → 1.0 (full)
  "typeClack.volume": 0.7,

  // Switch pack: "blue" | "brown" | "red"
  "typeClack.soundPack": "blue",

  // Silence sounds while the terminal panel is focused
  "typeClack.muteTerminal": true,

  // Play a startup sound when VS Code loads
  "typeClack.startupSound": true,

  // Limit sounds to specific language IDs (empty = all languages)
  "typeClack.enabledLanguages": [
    "javascript",
    "typescript",
    "python",
    "go",
    "rust"
  ]
}
```

---

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type **TypeClack**:

| Command | Description |
|---------|-------------|
| `TypeClack: Toggle Sounds` | Enable / disable TypeClack |
| `TypeClack: Select Sound Pack` | Pick a switch profile with preview |
| `TypeClack: Preview Blue Switch` | Hear the MX Blue sound and optionally switch |
| `TypeClack: Preview Brown Switch` | Hear the MX Brown sound and optionally switch |
| `TypeClack: Preview Red Switch` | Hear the MX Red sound and optionally switch |

---

## Status Bar

The status bar item (bottom-right) shows the current state:

```
⌨️ TypeClack ON    — sounds are active, click to mute
🔇 TypeClack OFF   — sounds are muted, click to enable
```

Hovering shows the active pack and volume. Clicking toggles on/off instantly.

---

## How It Works

TypeClack uses a **hidden VS Code Webview** that owns an `AudioContext`. The extension host (Node.js) sends JSON messages to the Webview telling it which sound to play; the Webview decodes the pre-loaded `AudioBuffer` and plays it through the native Web Audio API pipeline.

This design means:
- **Zero file system access** at play-time — each OGG sound sprite is base64-encoded and decoded into an `AudioBuffer` at activation
- **Low latency** — `AudioContext` with `latencyHint: 'interactive'` and pre-decoded buffers
- **No native addons** — works identically on macOS, Windows, and Linux
- **No memory leaks** — sources are pooled and released via `onended` callbacks

### Audio Source

The active Blue, Brown, and Red packs use Cherry MX sound sprites from the
MIT-licensed MechvibesDX project:

- `cherrymx-blue-pbt`
- `cherrymx-brown-pbt`
- `cherrymx-red-abs`

TypeClack decodes each pack's `sound.ogg` once, then plays short per-key slices
using timing data from the original soundpack config. See
`media/ATTRIBUTION.md` for source details.

---

## Building from Source

```bash
# Prerequisites
node --version   # v18+
npm --version    # v9+

# Clone and set up
git clone https://github.com/YourUsername/typeclack.git
cd typeclack
npm install

# (Optional) Re-synthesize the legacy WAV files
node generate-sounds.js

# Compile TypeScript
npm run compile

# Watch mode during development
npm run watch

# Package as VSIX
npm run package
# → typeclack-1.0.0.vsix
```

### Running in Development

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. Open any file and start typing

---

## Publishing to VS Code Marketplace

### 1. Create a Publisher

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with a Microsoft account
3. Click **Create publisher** and choose a unique publisher ID
4. Update `"publisher"` in `package.json` to match

### 2. Generate a Personal Access Token (PAT)

1. Go to https://dev.azure.com → your organisation → **User Settings → Personal access tokens**
2. Click **New Token**
3. Set **Scopes** → **Marketplace** → tick **Manage**
4. Copy the token

### 3. Login with vsce

```bash
npx vsce login YourPublisherNameHere
# Paste your PAT when prompted
```

### 4. Publish

```bash
# Publish current version
npm run publish
# or
npx vsce publish

# Publish and bump patch version
npx vsce publish patch

# Publish a specific version
npx vsce publish 1.0.1
```

### 5. Update the README

Replace every instance of `YourPublisherNameHere` and `YourUsername` with your actual publisher ID and GitHub username before publishing.

### Publishing Checklist

- [ ] `publisher` in `package.json` matches your Marketplace publisher ID
- [ ] `repository.url` points to your real GitHub repo
- [ ] `icon` file exists at `media/icon.png` (128×128 PNG)
- [ ] README doesn't reference placeholder names
- [ ] `CHANGELOG.md` is up to date
- [ ] `sound.ogg` files present in `media/blue/`, `media/brown/`, `media/red/`
- [ ] `npm run compile` succeeds with zero errors
- [ ] Extension tested in Extension Development Host

---

## Troubleshooting

**No sound at all?**
- Check the Audio Webview panel isn't blocked (VS Code may show a warning on first launch)
- Try the `TypeClack: Toggle Sounds` command to confirm the extension is active
- Check `typeClack.enabled` is `true` in settings

**Sound plays on paste/format?**
- This shouldn't happen; open a GitHub issue with the paste content that triggered it

**Sounds are too quiet?**
- Increase `typeClack.volume` to `0.9` or `1.0`
- Check your system volume and VS Code's audio permissions

**Terminal sounds aren't muting?**
- Ensure `typeClack.muteTerminal` is `true`
- Click inside the terminal panel (not just hover) so VS Code registers focus

---

## License

MIT © 2025 TypeClack Contributors
