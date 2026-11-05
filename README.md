# Simple Notepad

Double-click **Simple Notepad.exe** to start. No installation or extra packages are needed on this Windows PC.

- New, open, save, and save as, with prompts to protect unsaved changes.
- Plain-text editing, undo/redo, cut/copy/paste, and select all.
- Find (case-insensitive, wraps to the start), word wrap, font picker, and time/date insertion.
- Line, column, character count, and unsaved-change indicator.
- New files use UTF-8. Opening also supports BOM-marked UTF-8/UTF-16/UTF-32; the detected encoding and LF/CRLF line-ending style are retained on save. Invalid UTF-8 is reported rather than silently replaced.

Shortcuts: **Ctrl+N**, **Ctrl+O**, **Ctrl+S**, **Ctrl+Shift+S**, **Ctrl+F**, **Ctrl+Z**, **Ctrl+Y**, and **F5** (time/date).

You can also drag a text file onto the executable to open it, or pass a file path as its command-line argument.

Source: `Notepad.cs`. To rebuild, open PowerShell in this folder and run `powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1`.
