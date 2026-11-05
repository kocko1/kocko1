# Capri // Cyberpunk: Edgerunners S2 Desktop Widget

A lightweight, customizable floating desktop companion featuring **Capri** from *Cyberpunk: Edgerunners Season 2*. Built with **Electron**, featuring a transparent borderless always-on-top overlay, 4 reactive animation states, voice input, OS-keychain encrypted API storage, and a modular multi-provider AI router.

---

## Folder Structure

```text
capri/
├── assets/
│   ├── capri-sprite.png        # Transparent custom Edgerunners anime sprite of Capri
│   └── capri-sprite-raw.jpg    # High-contrast source render
├── src/
│   ├── main/
│   │   ├── main.js             # Electron main process (transparent overlay, tray, global shortcut, IPC)
│   │   ├── preload.js          # Context-isolated IPC bridge (window.capriBridge)
│   │   └── secureStore.js      # Multi-monitor position persistence & OS Keychain/DPAPI encryption
│   ├── services/
│   │   └── aiRouter.js         # Modular SSE streaming router (OpenAI, Claude, Gemini, Ollama/LM Studio)
│   └── renderer/
│       ├── index.html          # Floating sprite container, Cyberpunk HUD, and API Hub modal
│       ├── styles.css          # Cyberpunk neon styling (#00f0ff, #fcee0a, #ff0055), glitch & wave animations
│       └── app.js              # State machine, markdown renderer, speech-to-text, & browser fallback
├── .env.example                # Optional environment variable overrides
├── package.json                # Dependencies & electron-builder packaging targets
└── README.md                   # Setup, run, and build instructions
```

---

## Setup & Run Instructions

### 1. Prerequisites
- **Node.js** (v18+ or v20+ LTS recommended) — [Download Node.js](https://nodejs.org/)
- Optional for Local LLMs: [Ollama](https://ollama.com/) or [LM Studio](https://lmstudio.ai/) running at `http://localhost:11434/v1`

### 2. Install Dependencies
```powershell
cd c:\Users\jkoce\Documents\capri
npm install
```

### 3. Run in Development Mode
```powershell
npm start
# Or with detached Chromium DevTools:
npm run dev
```

> **Instant Browser Preview (Zero-Install Mode)**: You can also open `src/renderer/index.html` directly in any modern browser (Edge/Chrome) to preview the interactive Capri sprite states, HUD, and settings modal before installing Node/Electron.

### 4. Package as a Native Desktop App (.exe / .dmg / .AppImage)
```powershell
# Build Windows Installer & Portable .exe
npm run build:win

# Build macOS .dmg
npm run build:mac

# Build Linux AppImage
npm run build:linux
```

---

## Controls & Shortcuts

| Action | Trigger |
| :--- | :--- |
| **Toggle Prompt HUD** | **Left-click** Capri sprite |
| **Global Summon / Focus Input** | `Ctrl + Shift + Space` (works from any app) |
| **Move Capri Across Monitors** | **Click & Drag** Capri (auto-saves screen coordinates) |
| **System Tray / Context Menu** | **Right-click** Capri or click the system tray icon |
| **Toggle Click-Through Mode** | Right-click menu → *Click-Through Mode* |
| **Lock Position / Scale Size** | Right-click menu → *Lock Position* / *Scale Size (75%, 100%, 125%)* |
| **Configure API Keys** | Click `⚙` on the HUD or Right-click → *Configure AI Providers* |
