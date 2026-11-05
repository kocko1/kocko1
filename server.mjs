/**
 * Capri // Project Capricorn - OpenAI Codex MCP Server Plugin
 * Allows OpenAI Codex to speak through, animate, and summon the floating Capri desktop widget.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
import { fileURLToPath } from 'url';

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const CAPRI_APP_DIR = process.env.CAPRI_DATA_DIR || path.join(APPDATA, 'CapriEdgerunnerWidget');
const INBOX_FILE = path.join(CAPRI_APP_DIR, 'codex-plugin-inbox.json');
const localExe = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../Capri-Widget.exe');
const WIDGET_EXE = process.env.CAPRI_WIDGET_EXE || (fs.existsSync(localExe) ? localExe : path.join(os.homedir(), 'Documents', 'capri', 'Capri-Widget.exe'));
const STATES = ['idle', 'listening', 'thinking', 'speaking'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForInbox() {
  const deadline = Date.now() + 6000;
  while (fs.existsSync(INBOX_FILE)) {
    if (Date.now() >= deadline) throw new Error('Capri did not consume its inbox. Start Capri-Widget.exe and retry. Pending command preserved.');
    await pause(50);
  }
}

async function sendToCapriDesktopWidget(payload) {
  if (!fs.existsSync(CAPRI_APP_DIR)) {
    fs.mkdirSync(CAPRI_APP_DIR, { recursive: true });
  }
  const lockPath = path.join(CAPRI_APP_DIR, 'codex-plugin.lock');
  let lock;
  const deadline = Date.now() + 7000;
  while (lock === undefined) {
    try { lock = fs.openSync(lockPath, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('Another command holds the inbox lock. If all Capri MCP servers have stopped, remove codex-plugin.lock from the widget data directory.');
      await pause(50);
    }
  }
  const temporary = `${INBOX_FILE}.${process.pid}.tmp`;
  try {
    await waitForInbox();
    fs.writeFileSync(temporary, JSON.stringify(payload), 'utf-8');
    fs.renameSync(temporary, INBOX_FILE);
    await waitForInbox();
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
}

const TOOLS = [
  {
    name: 'capri_speak',
    description:
      'Make the floating Capri (Project Capricorn) desktop widget speak a message in her Cyberpunk speech bubble and log it in her HUD.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The text message for Capri to display and speak on the desktop.'
        },
        state: {
          type: 'string',
          enum: ['speaking', 'thinking', 'listening', 'idle'],
          description: 'Visual state for Capri (default: speaking).'
        }
      },
      required: ['message']
    }
  },
  {
    name: 'capri_set_state',
    description:
      'Switch the floating Capri desktop widget animation state (idle hover, listening audio wave, thinking glitch/data-stream, or speaking).',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['idle', 'listening', 'thinking', 'speaking'],
          description: 'Target animation state for Capri.'
        }
      },
      required: ['state']
    }
  },
  {
    name: 'capri_summon',
    description:
      'Launch or summon the floating Capri desktop widget and focus her Cyberpunk HUD on the desktop.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

async function handleRpcRequest(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return null;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'capri-companion-mcp',
          version: '1.0.1'
        }
      }
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS }
    };
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};
    if (typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object.');
    if (args.state !== undefined && !STATES.includes(args.state)) throw new Error('Invalid animation state.');
    if (toolName === 'capri_set_state' && !STATES.includes(args.state)) throw new Error('A valid state is required.');
    if (toolName === 'capri_speak' && (typeof args.message !== 'string' || !args.message.trim() || args.message.length > 10000)) throw new Error('Message must contain 1–10000 characters.');

    if (toolName === 'capri_speak') {
      await sendToCapriDesktopWidget({
        action: 'speak',
        message: args.message || 'Hi!',
        state: args.state || 'speaking'
      });
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: 'Capri consumed the message from its desktop inbox.' }]
        }
      };
    }

    if (toolName === 'capri_set_state') {
      await sendToCapriDesktopWidget({
        action: 'state',
        state: args.state || 'idle',
        message: ''
      });
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Capri visual state set to: ${args.state}` }]
        }
      };
    }

    if (toolName === 'capri_summon') {
      if (!fs.existsSync(WIDGET_EXE)) throw new Error('Capri-Widget.exe not found. Set CAPRI_WIDGET_EXE to its full path in the server environment.');
      {
        const child = spawn(WIDGET_EXE, [], { detached: true, stdio: 'ignore', windowsHide: true });
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        child.unref();
      }
      await sendToCapriDesktopWidget({
        action: 'summon',
        state: 'speaking',
        message: 'Hi! How can I help?'
      });
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: 'Capri widget summoned on desktop.' }]
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unknown tool: ${toolName}` }
    };
  }

  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id,
      result: {}
    };
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

let queue = Promise.resolve();
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try { parsed = JSON.parse(trimmed); }
  catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
  queue = queue.then(async () => {
    if (!parsed || parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: parsed?.id ?? null, error: { code: -32600, message: 'Invalid request' } }) + '\n'); return;
    }
    let resp;
    try { resp = await handleRpcRequest(parsed); }
    catch (error) { resp = { jsonrpc: '2.0', id: parsed.id, result: { isError: true, content: [{ type: 'text', text: error.message }] } }; }
    if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
  }).catch(error => console.error(error.message));
});
