# Changelog

All notable changes to TypeClack are documented here.

## [1.0.0] — 2025-06-14

### Added
- **Three switch profiles**: Cherry MX Blue (clicky), Brown (tactile), Red (linear)
- **Four key types**: regular keys (3 randomised variants), Enter, Backspace, Spacebar
- **Hidden Webview audio engine** using the Web Audio API for < 5 ms latency
- **Audio pool** — up to 8 concurrent sounds, polyphonic fast-typing support
- **Terminal muting** — silence when the integrated terminal has focus
- **Startup sound** — optional boot chime when VS Code loads
- **Language filter** — limit sounds to specific language IDs
- **Status bar** — `⌨️ TypeClack ON` / `🔇 TypeClack OFF` with click-to-toggle
- **Five commands**: Toggle, Select Pack, Preview Blue/Brown/Red
- **Throttling** — max 30 keystrokes/second to prevent audio spam
- Smart change classification — pastes, formats, snippets, and snippet expansion are silent
- All WAV files synthesized from a physical model of real switch acoustics
