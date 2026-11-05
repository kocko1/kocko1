---
name: capri-companion
description: Interact with and control the floating Capri (Project Capricorn from Cyberpunk: Edgerunners Season 2) desktop widget via the capri_widget MCP tools.
---

# Capri Desktop Companion Skill

Use the `capri_widget` MCP server tools (`capri_speak`, `capri_set_state`, `capri_summon`) whenever the user asks Capri to say something on their desktop, wants visual feedback on the Capri desktop overlay, or wants to summon the Capri HUD.

Use capri_summon to launch the native Windows widget and focus the HUD.
Use capri_speak with a nonblank message and optional state. Use capri_set_state
with idle, listening, thinking, or speaking. Speech means displayed text, not
guaranteed audio. Report errors honestly; a successful tool call confirms inbox
consumption and does not independently verify on-screen rendering.
If the widget is closed, start it before retrying a pending command.
Do not send unrelated conversation content to the widget automatically.
