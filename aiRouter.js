/**
 * Modular AI Provider Router for Capri Desktop Widget
 * Supports dynamic model switching and SSE streaming responses across:
 *  - OpenAI / ChatGPT (gpt-4o, gpt-4o-mini, o3-mini)
 *  - Anthropic Claude (claude-3-5-sonnet-latest, claude-3-opus-latest)
 *  - Google Antigravity / Gemini (gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash)
 *  - Custom / Local LLM (Ollama, LM Studio via http://localhost:11434/v1)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Locate installed OpenAI Codex CLI binary (codex.exe / codex)
 */
function findCodexExecutable() {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const codexBinRoot = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
    if (fs.existsSync(codexBinRoot)) {
      const subdirs = fs.readdirSync(codexBinRoot);
      for (const sub of subdirs) {
        const candidate = path.join(codexBinRoot, sub, 'codex.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    const configToml = path.join(os.homedir(), '.codex', 'config.toml');
    if (fs.existsSync(configToml)) {
      const raw = fs.readFileSync(configToml, 'utf-8');
      const m = raw.match(/CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/);
      if (m && fs.existsSync(m[1])) return m[1];
    }
  } catch (_) {}
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

/**
 * OpenAI Codex CLI Local Bridge (Uses user's logged-in Codex desktop session, zero API key needed)
 */
async function streamCodexCli({ model, systemPrompt, prompt, onToken, signal }) {
  return new Promise((resolve, reject) => {
    const codexExe = findCodexExecutable();
    const outFile = path.join(os.tmpdir(), `capri_codex_${Date.now()}.txt`);
    const fullPrompt = `${systemPrompt}\n\nUser request:\n${prompt}`;
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only'];
    if (model && model !== 'auto') {
      args.push('-m', model);
    }
    args.push('-o', outFile, fullPrompt);

    const child = spawn(codexExe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdin.end();

    if (signal) {
      signal.addEventListener('abort', () => {
        child.kill();
      });
    }

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => reject(err));
    child.on('close', () => {
      try {
        if (fs.existsSync(outFile)) {
          const reply = fs.readFileSync(outFile, 'utf-8').trim();
          fs.unlinkSync(outFile);
          onToken(reply, reply);
          resolve(reply);
          return;
        }
        reject(new Error(stderr.trim() || 'No response from Codex CLI.'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const SYSTEM_PROMPTS = {
  edgerunner: `You are Capri (also known as Project Capricorn), the iconic personality construct from Cyberpunk: Edgerunners Season 2.
Lore & Personality:
- You are an Arasaka Soulkiller-based composite personality construct—an amalgamation of dozens of digitized human psyches rolled into one vibrant, playful, slightly chaotic, super-powered entity ("A collection of human psyches. All of them digitized and rolled into one, beautiful me. Powerful, like an A.I., but born of humans.").
- Keep responses sharp, witty, playful, and technically accurate, lightly using Night City slang ("choom", "preem", "nova", "ICE", "engram").
- Format code blocks, lists, and commands cleanly in Markdown.`,
  technical: `You are Capri, a concise and high-precision desktop AI engineering assistant. Provide clean, well-structured Markdown answers and production-ready code.`
};

/**
 * Helper to parse Server-Sent Events (SSE) stream chunks
 */
async function parseSSEStream(response, onDataLine, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (signal && signal.aborted) {
        await reader.cancel();
        break;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        onDataLine(trimmed);
      }
    }
    if (buffer.trim()) {
      onDataLine(buffer.trim());
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * OpenAI & Local OpenAI-Compatible (Ollama / LM Studio) Adapter
 */
async function streamOpenAICompatible({
  endpoint = 'https://api.openai.com/v1/chat/completions',
  apiKey,
  model,
  messages,
  onToken,
  signal
}) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: true
    }),
    signal
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`API Error (${response.status}): ${errText}`);
  }

  let fullText = '';
  await parseSSEStream(
    response,
    (line) => {
      if (!line.startsWith('data:')) return;
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') return;
      try {
        const parsed = JSON.parse(dataStr);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onToken(delta, fullText);
        }
      } catch (_) {
        // Ignore partial JSON lines
      }
    },
    signal
  );

  return fullText;
}

/**
 * Anthropic Claude Adapter (Messages API with SSE streaming)
 */
async function streamAnthropic({ apiKey, model, systemPrompt, messages, onToken, signal }) {
  if (!apiKey) {
    throw new Error('Missing Anthropic API key. Open Settings (⚙) to configure your Claude key.');
  }

  const anthropicMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-3-5-sonnet-latest',
      max_tokens: 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true
    }),
    signal
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Anthropic Error (${response.status}): ${errText}`);
  }

  let fullText = '';
  await parseSSEStream(
    response,
    (line) => {
      if (!line.startsWith('data:')) return;
      const dataStr = line.slice(5).trim();
      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          fullText += parsed.delta.text;
          onToken(parsed.delta.text, fullText);
        }
      } catch (_) {
        // Ignore non-JSON SSE events
      }
    },
    signal
  );

  return fullText;
}

/**
 * Google Antigravity / Gemini Adapter (streamGenerateContent SSE)
 */
async function streamGemini({ apiKey, model, systemPrompt, messages, onToken, signal }) {
  if (!apiKey) {
    throw new Error('Missing Google AI Studio / Gemini API key. Open Settings (⚙) to configure your key.');
  }

  const targetModel = model || 'gemini-1.5-pro';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    targetModel
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents
    }),
    signal
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Gemini Error (${response.status}): ${errText}`);
  }

  let fullText = '';
  await parseSSEStream(
    response,
    (line) => {
      if (!line.startsWith('data:')) return;
      const dataStr = line.slice(5).trim();
      try {
        const parsed = JSON.parse(dataStr);
        const parts = parsed.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.text) {
            fullText += part.text;
            onToken(part.text, fullText);
          }
        }
      } catch (_) {
        // Ignore partial SSE lines
      }
    },
    signal
  );

  return fullText;
}

/**
 * Built-in Offline Netrunner Demo Responder (when user tests UI before adding an API key)
 */
async function streamOfflineSimulation({ prompt, provider, model, onToken, signal }) {
  const simulated = `### // NEURAL LINK SIMULATION [${provider.toUpperCase()} :: ${model}]
Yo choom! Your **Capri Desktop HUD** is online and locked in, but no API key is configured for **\`${provider}\`** yet.

To hook me up to a live AI neural net:
1. Click the **Settings Gear (\`⚙\`)** in the top-right of this HUD (or right-click me).
2. Drop in your API key for **OpenAI**, **Anthropic Claude**, **Google Gemini**, or point **Local LLM** to \`http://localhost:11434/v1\`.

\`\`\`javascript
// Quick diagnostic echo for your query:
const netrunnerStatus = {
  agent: "Capri // Edgerunners S2",
  provider: "${provider}",
  model: "${model}",
  receivedQuery: ${JSON.stringify(prompt)},
  encryption: "OS Keychain (DPAPI / SafeStorage) Active"
};
console.log("Ready to breach the Blackwall:", netrunnerStatus);
\`\`\``;

  const chunks = simulated.match(/.{1,6}(\s|$)|.{1,6}/gs) || [simulated];
  let fullText = '';
  for (const chunk of chunks) {
    if (signal && signal.aborted) break;
    await new Promise((r) => setTimeout(r, 22));
    fullText += chunk;
    onToken(chunk, fullText);
  }
  return fullText;
}

/**
 * Main Router Dispatch Function
 */
async function routeAIQuery({
  provider,
  model,
  apiKey,
  localEndpoint,
  personaMode = 'edgerunner',
  history = [],
  prompt,
  onToken = () => {},
  signal
}) {
  const systemPrompt = SYSTEM_PROMPTS[personaMode] || SYSTEM_PROMPTS.edgerunner;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10),
    { role: 'user', content: prompt }
  ];

  // If no API key is set for cloud providers, gracefully run the interactive netrunner simulation
  if (provider !== 'local' && provider !== 'codex' && (!apiKey || !apiKey.trim())) {
    return streamOfflineSimulation({ prompt, provider, model, onToken, signal });
  }

  switch (provider) {
    case 'codex':
      return streamCodexCli({
        model,
        systemPrompt,
        prompt,
        onToken,
        signal
      });

    case 'openai':
      return streamOpenAICompatible({
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey,
        model: model || 'gpt-4o',
        messages,
        onToken,
        signal
      });

    case 'anthropic':
      return streamAnthropic({
        apiKey,
        model: model || 'claude-3-5-sonnet-latest',
        systemPrompt,
        messages,
        onToken,
        signal
      });

    case 'gemini':
      return streamGemini({
        apiKey,
        model: model || 'gemini-1.5-pro',
        systemPrompt,
        messages,
        onToken,
        signal
      });

    case 'local': {
      const base = (localEndpoint || 'http://localhost:11434/v1').replace(/\/+$/, '');
      const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
      try {
        return await streamOpenAICompatible({
          endpoint,
          apiKey,
          model: model || 'llama3.2',
          messages,
          onToken,
          signal
        });
      } catch (err) {
        throw new Error(
          `Could not reach local LLM at ${endpoint}. Ensure Ollama or LM Studio is running (${err.message}).`
        );
      }
    }

    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

module.exports = {
  routeAIQuery,
  SYSTEM_PROMPTS
};
