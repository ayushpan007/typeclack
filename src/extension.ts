/**
 * TypeClack — Realistic mechanical keyboard sounds for VS Code
 *
 * Architecture overview:
 *  ┌─────────────────────────┐      messages       ┌──────────────────────┐
 *  │  extension.ts (Node.js) │ ──────────────────► │  AudioWebview (HTML) │
 *  │  - text change events   │                     │  - Web Audio API     │
 *  │  - commands             │ ◄────────────────── │  - audio pool        │
 *  │  - status bar           │   ready / ack       │  - OGG sprite cache  │
 *  └─────────────────────────┘                     └──────────────────────┘
 *
 * The hidden Webview owns all audio. The extension host sends JSON messages
 * telling it which sound to play; the Webview decodes + plays via AudioContext.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// ─── Types ───────────────────────────────────────────────────

type SoundPack = "blue" | "brown" | "red";

interface TypeClackConfig {
  enabled: boolean;
  volume: number;
  soundPack: SoundPack;
  muteTerminal: boolean;
  startupSound: boolean;
  enabledLanguages: string[];
}

interface WebviewMessage {
  command: "play" | "setVolume" | "preload" | "setPack";
  sound?: string; // e.g. "key1", "enter", "backspace", "space"
  pack?: SoundPack;
  volume?: number;
  audioData?: string;
  slices?: Record<string, SoundSlice>;
}

interface SoundSlice {
  startMs: number;
  endMs: number;
}

interface SoundSprite {
  file: string;
  mimeType: string;
  slices: Record<string, SoundSlice>;
}

// ─── Constants ───────────────────────────────────────────────

/** Max keystrokes per second before throttling kicks in */
const MAX_RATE_HZ = 30;
/** How often the throttle window resets (ms) */
const THROTTLE_WINDOW_MS = 1000 / MAX_RATE_HZ;

const SOUND_SPRITES: Record<SoundPack, SoundSprite> = {
  blue: {
    file: "sound.ogg",
    mimeType: "audio/ogg",
    slices: {
      key1: { startMs: 28961, endMs: 29043 },
      key2: { startMs: 29448, endMs: 29533.5 },
      key3: { startMs: 29968, endMs: 30049.5 },
      enter: { startMs: 34274, endMs: 34376 },
      backspace: { startMs: 16906, endMs: 17021 },
      space: { startMs: 49628, endMs: 49743 },
    },
  },
  brown: {
    file: "sound.ogg",
    mimeType: "audio/ogg",
    slices: {
      key1: { startMs: 22869, endMs: 22968 },
      key2: { startMs: 23237, endMs: 23326 },
      key3: { startMs: 23586, endMs: 23679.5 },
      enter: { startMs: 26703, endMs: 26793.5 },
      backspace: { startMs: 13765, endMs: 13857 },
      space: { startMs: 34910, endMs: 35021.5 },
    },
  },
  red: {
    file: "sound.ogg",
    mimeType: "audio/ogg",
    slices: {
      key1: { startMs: 27942, endMs: 28017.5 },
      key2: { startMs: 28366, endMs: 28454.5 },
      key3: { startMs: 28771, endMs: 28855 },
      enter: { startMs: 32833, endMs: 32928 },
      backspace: { startMs: 16727, endMs: 16840.5 },
      space: { startMs: 42071, endMs: 42186 },
    },
  },
};

// ─── Extension entry points ──────────────────────────────────

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const manager = new TypeClackManager(context);
  await manager.initialize();

  // Register all disposables so VS Code cleans them up on deactivation
  context.subscriptions.push(manager);
}

export function deactivate(): void {
  // Manager.dispose() is called automatically via context.subscriptions
}

// ─── TypeClackManager ────────────────────────────────────────

class TypeClackManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private statusBar: vscode.StatusBarItem;
  private config: TypeClackConfig;
  private webviewReady = false;
  private pendingMessages: WebviewMessage[] = [];
  private lastPlayTime = 0; // for throttling
  private isTerminalFocused = false;
  private isDisposed = false;
  private readonly disposables: vscode.Disposable[] = [];
  private keyVariantIndex = 0; // cycles key1→key2→key3

  constructor(private readonly context: vscode.ExtensionContext) {
    this.config = this.readConfig();

    // Status bar item
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.command = "typeClack.toggle";
    this.statusBar.show();
    this.disposables.push(this.statusBar);
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.config.enabled) {
      this.createWebview();
    }
    this.registerCommands();
    this.registerListeners();
    this.updateStatusBar();
  }

  dispose(): void {
    this.isDisposed = true;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.panel?.dispose();
  }

  // ─── Webview ───────────────────────────────────────────────

  private createWebview(): void {
    this.panel = vscode.window.createWebviewPanel(
      "typeClackAudio",
      "TypeClack Audio",
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true, // keep AudioContext alive
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "media"),
        ],
      },
    );

    // Hide the webview tab visually — it's an audio engine, not UI
    this.panel.title = "";

    this.panel.webview.html = this.buildWebviewHtml();

    // Listen for messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (msg: { type: string }) => {
        if (msg.type === "ready") {
          this.webviewReady = true;
          this.flushPendingMessages();
          this.preloadCurrentPack();

          if (this.config.startupSound && this.config.enabled) {
            // Small delay to let preloading settle
            setTimeout(() => this.playSound("key1"), 400);
          }
        }
      },
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.webviewReady = false;

        // If the extension was enabled, it means the user manually closed the tab.
        // We should disable the extension so they don't get stuck in a weird state, and show a status bar warning.
        if (!this.isDisposed && this.config.enabled) {
          void vscode.workspace
            .getConfiguration()
            .update("typeClack.enabled", false, vscode.ConfigurationTarget.Global);
          vscode.window.setStatusBarMessage("🔇 TypeClack: Disabled (Audio Engine closed)", 3500);
        }
      },
      undefined,
      this.disposables,
    );

    this.disposables.push(this.panel);
  }

  // ─── Commands ──────────────────────────────────────────────

  private registerCommands(): void {
    const reg = (id: string, fn: () => void | Promise<void>) =>
      this.disposables.push(vscode.commands.registerCommand(id, fn));

    reg("typeClack.toggle", () => this.toggle());

    reg("typeClack.previewBlue", async () => {
      await this.previewPack("blue");
    });

    reg("typeClack.previewBrown", async () => {
      await this.previewPack("brown");
    });

    reg("typeClack.previewRed", async () => {
      await this.previewPack("red");
    });

    reg("typeClack.selectPack", async () => {
      const items = [
        {
          label: "$(keyboard) Cherry MX Blue",
          description: "Tactile clicky — classic loud mechanical click",
          detail:
            this.config.soundPack === "blue" ? "$(check) Currently active" : "",
          value: "blue" as SoundPack,
        },
        {
          label: "$(keyboard) Cherry MX Brown",
          description: "Tactile bump — quieter, softer thock",
          detail:
            this.config.soundPack === "brown"
              ? "$(check) Currently active"
              : "",
          value: "brown" as SoundPack,
        },
        {
          label: "$(keyboard) Cherry MX Red",
          description: "Linear switch — smooth and very quiet",
          detail:
            this.config.soundPack === "red" ? "$(check) Currently active" : "",
          value: "red" as SoundPack,
        },
      ];

      const chosen = await vscode.window.showQuickPick(items, {
        title: "TypeClack — Select Sound Pack",
        placeHolder: "Choose a keyboard switch sound profile",
        matchOnDescription: true,
      });

      if (!chosen) {
        return;
      }

      await vscode.workspace
        .getConfiguration()
        .update(
          "typeClack.soundPack",
          chosen.value,
          vscode.ConfigurationTarget.Global,
        );

      this.config = this.readConfig();
      this.preloadCurrentPack();
      this.updateStatusBar();

      // Play a sample from the new pack
      setTimeout(() => this.playSound("key2"), 200);

      vscode.window.setStatusBarMessage(
        `$(keyboard) TypeClack: switched to ${chosen.label.replace("$(keyboard) ", "")}`,
        3000,
      );
    });
  }

  // ─── Event listeners ───────────────────────────────────────

  private registerListeners(): void {
    // ── Text document changes (the core typing detection) ──
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!this.shouldPlay()) {
          return;
        }

        const doc = event.document;

        // Skip non-editor schemes
        if (!["file", "untitled", "vscode-userdata"].includes(doc.uri.scheme)) {
          return;
        }

        // Only play if the change is in the active text editor (implies user is actively typing in it)
        if (vscode.window.activeTextEditor?.document !== doc) {
          return;
        }

        // Language filter (empty array = all languages)
        if (
          this.config.enabledLanguages.length > 0 &&
          !this.config.enabledLanguages.includes(doc.languageId)
        ) {
          return;
        }

        const changes = event.contentChanges;
        if (changes.length === 0) {
          return;
        }

        // Throttle: skip if last sound was too recent
        const now = Date.now();
        if (now - this.lastPlayTime < THROTTLE_WINDOW_MS) {
          return;
        }
        this.lastPlayTime = now;

        // Multi-cursor: if all changes are single chars, play once
        const isMultiCursorSingle =
          changes.length > 1 &&
          changes.every((c) => c.text.length <= 1 && c.rangeLength <= 1);
        if (changes.length > 1 && !isMultiCursorSingle) {
          return;
        }

        const change = changes[0];
        const sound = this.classifyChange(change);
        if (sound) {
          this.playSound(sound);
        }
      }),
    );

    // ── Configuration changes ──
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("typeClack")) {
          return;
        }
        const prev = this.config;
        this.config = this.readConfig();

        if (prev.enabled !== this.config.enabled) {
          if (this.config.enabled) {
            if (!this.panel) {
              this.createWebview();
            }
          } else {
            if (this.panel) {
              this.panel.dispose();
              this.panel = undefined;
              this.webviewReady = false;
            }
          }
        }

        if (this.config.enabled) {
          if (prev.soundPack !== this.config.soundPack) {
            this.preloadCurrentPack();
          }
          if (prev.volume !== this.config.volume) {
            this.sendMessage({
              command: "setVolume",
              volume: this.config.volume,
            });
          }
        }
        this.updateStatusBar();
      }),
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        this.isTerminalFocused =
          terminal !== undefined && !vscode.window.activeTextEditor;
      }),
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.isTerminalFocused = editor === undefined && vscode.window.activeTerminal !== undefined;
      }),
    );
  }

  // ─── Sound classification ──────────────────────────────────

  private classifyChange(
    change: vscode.TextDocumentContentChangeEvent,
  ): string | null {
    const inserted = change.text;
    const deleted = change.rangeLength;

    // Pure deletion → backspace (only single-char to filter bulk delete/cut)
    if (inserted === "" && deleted === 1) {
      return "backspace";
    }
    if (inserted === "" && deleted > 1) {
      return null; // bulk delete — no sound
    }

    // Single character inserted
    if (inserted.length === 1) {
      if (inserted === "\n" || inserted === "\r") {
        return "enter";
      }
      if (inserted === " ") {
        return "space";
      }
      return this.nextKeyVariant();
    }

    // Newline + auto-indent (user pressed Enter in code)
    if (
      (inserted.startsWith("\n") || inserted.startsWith("\r\n")) &&
      /^\r?\n\s*$/.test(inserted) &&
      deleted === 0
    ) {
      return "enter";
    }

    // Paste / snippet / format — no sound
    return null;
  }

  /** Cycles through key1, key2, key3 for natural variation */
  private nextKeyVariant(): string {
    this.keyVariantIndex = (this.keyVariantIndex + 1) % 3;
    return `key${this.keyVariantIndex + 1}`;
  }

  // ─── Playback ──────────────────────────────────────────────

  private shouldPlay(): boolean {
    if (!this.config.enabled) {
      return false;
    }
    if (this.config.muteTerminal && this.isTerminalFocused) {
      return false;
    }
    return true;
  }

  private playSound(sound: string): void {
    this.sendMessage({
      command: "play",
      sound,
      pack: this.config.soundPack,
    });
  }

  private async previewPack(pack: SoundPack): Promise<void> {
    // Temporarily load the pack, play a sample, then restore
    await this.preloadPack(pack);

    const prevPack = this.config.soundPack;
    this.sendMessage({ command: "play", sound: "key1", pack });

    // Offer to switch
    const choice = await vscode.window.showInformationMessage(
      `TypeClack: Previewing Cherry MX ${pack.charAt(0).toUpperCase() + pack.slice(1)} switch. Switch to this pack?`,
      "Yes, switch",
      "No thanks",
    );

    if (choice === "Yes, switch") {
      await vscode.workspace
        .getConfiguration()
        .update("typeClack.soundPack", pack, vscode.ConfigurationTarget.Global);
    } else {
      // Reload previous pack
      await this.preloadPack(prevPack);
    }
  }

  // ─── Audio preloading ──────────────────────────────────────

  private preloadCurrentPack(): void {
    void this.preloadPack(this.config.soundPack);
  }

  private async preloadPack(pack: SoundPack): Promise<void> {
    const packDir = path.join(this.context.extensionPath, "media", pack);
    const sprite = SOUND_SPRITES[pack];
    const filePath = path.join(packDir, sprite.file);

    try {
      const buffer = await fs.promises.readFile(filePath);
      const b64 = buffer.toString("base64");
      this.sendMessage({
        command: "preload",
        pack,
        audioData: `data:${sprite.mimeType};base64,${b64}`,
        slices: sprite.slices,
      });
    } catch (err) {
      console.error(`[TypeClack] Could not read ${filePath}:`, err);
    }
  }

  // ─── Toggle ────────────────────────────────────────────────

  private async toggle(): Promise<void> {
    const nextEnabled = !this.config.enabled;
    await vscode.workspace
      .getConfiguration()
      .update(
        "typeClack.enabled",
        nextEnabled,
        vscode.ConfigurationTarget.Global,
      );

    const msg = nextEnabled
      ? "$(unmute) TypeClack: Sounds ON"
      : "$(mute) TypeClack: Sounds OFF";
    vscode.window.setStatusBarMessage(msg, 2500);
  }

  // ─── Status bar ────────────────────────────────────────────

  private updateStatusBar(): void {
    const packLabel: Record<SoundPack, string> = {
      blue: "Blue",
      brown: "Brown",
      red: "Red",
    };

    if (this.config.enabled) {
      this.statusBar.text = `⌨️ TypeClack ON`;
      this.statusBar.tooltip =
        `TypeClack is ON\nPack: MX ${packLabel[this.config.soundPack]}\n` +
        `Volume: ${Math.round(this.config.volume * 100)}%\n\nClick to toggle`;
      this.statusBar.backgroundColor = undefined;
      this.statusBar.color = undefined;
    } else {
      this.statusBar.text = `🔇 TypeClack OFF`;
      this.statusBar.tooltip = "TypeClack is OFF — click to enable";
      this.statusBar.color = new vscode.ThemeColor(
        "statusBarItem.warningForeground",
      );
    }
  }

  // ─── Config ────────────────────────────────────────────────

  private readConfig(): TypeClackConfig {
    const cfg = vscode.workspace.getConfiguration("typeClack");
    return {
      enabled: cfg.get<boolean>("enabled", true),
      volume: Math.max(0, Math.min(1, cfg.get<number>("volume", 0.7))),
      soundPack: cfg.get<SoundPack>("soundPack", "blue"),
      muteTerminal: cfg.get<boolean>("muteTerminal", true),
      startupSound: cfg.get<boolean>("startupSound", true),
      enabledLanguages: cfg.get<string[]>("enabledLanguages", []),
    };
  }

  // ─── Webview messaging ─────────────────────────────────────

  private sendMessage(msg: WebviewMessage): void {
    if (!this.webviewReady || !this.panel) {
      // Don't queue real-time sound play messages, only state changes
      if (msg.command !== "play") {
        this.pendingMessages.push(msg);
      }
      return;
    }
    void this.panel.webview.postMessage(msg);
  }

  private flushPendingMessages(): void {
    for (const msg of this.pendingMessages) {
      void this.panel?.webview.postMessage(msg);
    }
    this.pendingMessages = [];
  }

  // ─── Webview HTML ──────────────────────────────────────────

  private buildWebviewHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'unsafe-inline'; connect-src data:; media-src data:;">
  <title>TypeClack Audio Engine</title>
  <style>
    body {
      background: #0d0d0d;
      color: #888;
      font-family: monospace;
      font-size: 11px;
      padding: 12px;
      margin: 0;
    }
    #status { color: #4a90d9; margin-bottom: 8px; }
    #log { opacity: 0.5; max-height: 200px; overflow-y: auto; }
    .line { border-bottom: 1px solid #1a1a1a; padding: 1px 0; }
  </style>
</head>
<body>
  <div id="status">⌨️ TypeClack Audio Engine</div>
  <div id="log"></div>

  <script>
  (function() {
    'use strict';

    // ── State ──────────────────────────────────────────────
    const vscode = acquireVsCodeApi();
    let ctx = null;                           // AudioContext
    let volume = ${this.config.volume};       // master volume
    let currentPack = '${this.config.soundPack}';

    // bufferCache[pack] = { buffer: AudioBuffer, slices: { soundName: timing } }
    const bufferCache = {};

    // Pool: keep decoded AudioBuffers ready; limit concurrent sources
    const MAX_SOURCES = 8;
    const activeSources = new Set();

    // ── Logging ────────────────────────────────────────────
    const logEl = document.getElementById('log');
    function log(msg) {
      const d = document.createElement('div');
      d.className = 'line';
      d.textContent = new Date().toLocaleTimeString('en-US', { hour12: false }) + '  ' + msg;
      logEl.prepend(d);
      if (logEl.children.length > 60) { logEl.lastChild.remove(); }
    }

    // ── AudioContext (lazy init on first user interaction) ──
    function ensureContext() {
      if (ctx) {
        if (ctx.state === 'suspended') { ctx.resume(); }
        return ctx;
      }
      ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
      log('AudioContext created @ ' + ctx.sampleRate + 'Hz');
      return ctx;
    }

    // ── Decode + cache a single sound sprite data URL ──
    async function decodeSprite(pack, dataUrl, slices) {
      try {
        const ac = ensureContext();
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx === -1) {
          throw new Error('Invalid data URL');
        }
        const base64 = dataUrl.substring(commaIdx + 1);
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const audioBuf = await ac.decodeAudioData(bytes.buffer);
        bufferCache[pack] = { buffer: audioBuf, slices: slices || {} };
      } catch (err) {
        log('ERR decode ' + pack + ': ' + err.message);
      }
    }

    // ── Play a sound from the cache ──
    async function playSound(pack, soundName) {
      const ac = ensureContext();
      if (ac.state !== 'running') {
        try {
          await ac.resume();
          log('AudioContext resumed');
        } catch (e) {
          log('Resume failed: ' + e);
          return;
        }
        console.log('STATE:', ac.state);
      }

      const packCache = bufferCache[pack];
      if (!packCache) { log('WARN: pack ' + pack + ' not loaded yet'); return; }

      const slice = packCache.slices[soundName];
      if (!slice) { log('WARN: ' + soundName + ' not in ' + pack + ' sprite'); return; }

      const startSeconds = slice.startMs / 1000;
      const durationSeconds = Math.max(0.01, (slice.endMs - slice.startMs) / 1000);

      // Polyphony: evict oldest source if pool is full
      if (activeSources.size >= MAX_SOURCES) {
        const oldest = activeSources.values().next().value;
        try { oldest.stop(0); } catch (_) {}
        activeSources.delete(oldest);
      }

      const gainNode = ac.createGain();
      gainNode.gain.setValueAtTime(volume, ac.currentTime);
      gainNode.connect(ac.destination);

      const source = ac.createBufferSource();
      source.buffer = packCache.buffer;
      source.connect(gainNode);

      source.onended = () => {
        activeSources.delete(source);
        gainNode.disconnect();
      };

      activeSources.add(source);
      source.start(0, startSeconds, durationSeconds);
    }

    // ── Handle messages from extension host ──
    window.addEventListener('message', async (event) => {
      const msg = event.data;

      switch (msg.command) {

        case 'preload': {
          const pack = msg.pack;
          const sliceCount = Object.keys(msg.slices || {}).length;
          log('Preloading sound sprite for pack: ' + pack);
          await decodeSprite(pack, msg.audioData, msg.slices);
          log('Pack ready: ' + pack + ' (' + sliceCount + ' slices)');
          if (pack === currentPack) { currentPack = pack; }
          break;
        }

        case 'play': {
          const pack = msg.pack || currentPack;
          const sound = msg.sound || 'key1';
          playSound(pack, sound);
          break;
        }

        case 'setVolume': {
          volume = Math.max(0, Math.min(1, msg.volume || 0.7));
          log('Volume set to ' + Math.round(volume * 100) + '%');
          break;
        }

        case 'setPack': {
          currentPack = msg.pack || 'blue';
          log('Active pack: ' + currentPack);
          break;
        }
      }
    });

    // ── Signal ready ──
    document.addEventListener('DOMContentLoaded', () => {
      // Eagerly init AudioContext (it will be in 'running' on user interaction;
      // for now, creating it here primes the pipeline)
      ensureContext();
      vscode.postMessage({ type: 'ready' });
      log('TypeClack audio engine ready');
    });

    // Browsers may suspend AudioContext until user gesture — resume on any click
    document.addEventListener('click', () => ensureContext(), { passive: true });

  })();
  </script>
</body>
</html>`;
  }
}
