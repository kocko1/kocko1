# Capri Companion

Private local Codex plugin for the native Windows `Capri-Widget.exe`.
Requires Node.js 18+ on PATH. No npm dependencies or API key are needed.
The Electron and browser previews do not implement this native command inbox.

## Setup

Keep this folder beside `Capri-Widget.exe`, or set `CAPRI_WIDGET_EXE` in the
`capri_widget` server's `env` object to the executable's absolute path.
Cached installations also look in your Windows user profile's `Documents/capri`.
Install through a local Codex plugin marketplace. The portable manifest is
`plugin.json` with `mcp.json`; `.codex-plugin/plugin.json` and `.mcp.json`
provide the Codex compatibility configuration.

Ask Codex to summon Capri, say a message, or set idle, listening, thinking,
or speaking state. Start the native widget before sending state or speech.
Summon can start it for you. These tools control display and animation;
they do not enable text-to-speech audio.

Commands are serialized and atomically written to
`%APPDATA%/CapriEdgerunnerWidget/codex-plugin-inbox.json`.
Success means the widget consumed the inbox, not verified on-screen rendering.
If it is closed, the command remains pending and the tool reports an error.
Start the widget to consume it before retrying. After a server crash, if no
Capri MCP server remains running, remove `codex-plugin.lock` in that directory.
`CAPRI_DATA_DIR` overrides the inbox directory for isolated tests; the native
widget always uses its normal application-data directory.

This plugin runs on your Windows computer. Uploading the package does not
make the local executable accessible to ChatGPT on web or mobile.
