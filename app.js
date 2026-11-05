/**
 * Capri // Cyberpunk: Edgerunners Season 2 Desktop Companion
 * Renderer Controller (Supports both Electron IPC Bridge & Standalone Browser Preview)
 */

// ============================================================================
// 1. STANDALONE BROWSER FALLBACK BRIDGE (if opened outside Electron)
// ============================================================================
function createBrowserFallbackBridge() {
  const STORAGE_KEY = 'capri_browser_config_v1';
  const KEYS_STORAGE = 'capri_browser_keys_v1';

  const defaultConfig = {
    scale: 'medium',
    locked: false,
    clickThrough: false,
    spriteStyle: 'image',
    personaMode: 'edgerunner',
    activeProvider: 'gemini',
    activeModel: 'gemini-1.5-pro',
    providers: {
      openai: { model: 'gpt-4o' },
      anthropic: { model: 'claude-3-5-sonnet-latest' },
      gemini: { model: 'gemini-1.5-pro' },
      local: { endpoint: 'http://localhost:11434/v1', model: 'llama3.2' }
    }
  };

  const loadConfig = () => {
    try {
      return { ...defaultConfig, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch (_) {
      return { ...defaultConfig };
    }
  };

  const loadKeys = () => {
    try {
      return JSON.parse(localStorage.getItem(KEYS_STORAGE) || '{}');
    } catch (_) {
      return {};
    }
  };

  const getKeysStatus = () => {
    const keys = loadKeys();
    const out = {};
    for (const p of ['openai', 'anthropic', 'gemini', 'local']) {
      const k = keys[p] || '';
      out[p] = {
        hasKey: Boolean(k),
        masked: k.length > 8 ? `${k.slice(0, 4)}••••${k.slice(-4)}` : (k ? '••••' : '')
      };
    }
    return out;
  };

  let tokenListeners = [];
  let completeListeners = [];
  let errorListeners = [];
  let settingsListeners = [];
  let activeAbort = null;

  return {
    isElectron: false,
    async getSettings() {
      return { config: loadConfig(), keysStatus: getKeysStatus() };
    },
    async updateSettings(partial) {
      const next = { ...loadConfig(), ...partial };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      const payload = { config: next, keysStatus: getKeysStatus() };
      settingsListeners.forEach((fn) => fn(payload));
      return payload;
    },
    async setApiKey(provider, apiKey) {
      const keys = loadKeys();
      if (!apiKey || !apiKey.trim()) delete keys[provider];
      else keys[provider] = apiKey.trim();
      localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
      return { config: loadConfig(), keysStatus: getKeysStatus() };
    },
    moveWindowBy(dx, dy) {
      const root = document.getElementById('widget-root');
      const curX = parseFloat(root.dataset.offsetX || '0') + dx;
      const curY = parseFloat(root.dataset.offsetY || '0') + dy;
      root.dataset.offsetX = String(curX);
      root.dataset.offsetY = String(curY);
      root.style.left = `${curX}px`;
      root.style.top = `${curY}px`;
    },
    setIgnoreMouseEvents() {},
    showContextMenu() {},
    startAIStream({ requestId, prompt, history = [], overrideProvider, overrideModel }) {
      if (activeAbort) activeAbort.abort();
      activeAbort = new AbortController();
      const signal = activeAbort.signal;
      const cfg = loadConfig();
      const keys = loadKeys();
      const provider = overrideProvider || cfg.activeProvider || 'gemini';
      const model = overrideModel || cfg.activeModel || 'gemini-1.5-pro';
      const apiKey = keys[provider] || '';
      const sysPrompt =
        cfg.personaMode === 'technical'
          ? 'You are Capri, a concise and high-precision desktop AI engineering assistant. Provide clean Markdown answers and production-ready code.'
          : 'You are Capri (Project Capricorn), the composite personality construct from Cyberpunk: Edgerunners Season 2—a collection of digitized human psyches rolled into one playful, sharp, super-powered entity. Keep responses sharp, helpful, concise, and lightly flavored with Night City slang.';

      const emitToken = (delta, acc) => {
        tokenListeners.forEach((fn) => fn({ requestId, delta, accumulated: acc }));
      };

      (async () => {
        try {
          // If cloud provider has no key configured yet, run interactive Netrunner Simulation
          if (provider !== 'local' && !apiKey.trim()) {
            const demoText = `### // CAPRI NET-LINK [${provider.toUpperCase()} :: ${model}]
Preem signal, choom! Here's the breakdown for **"${prompt}"**:

- **Overlay Status**: Ready & Zero-Install Portable Mode active.
- **Active Engine**: \`${provider} / ${model}\`
- **Live AI Hookup**: Click \`⚙\` in the top-right to drop in your **Gemini**, **OpenAI**, or **Claude** key, or point **Local LLM** to \`http://localhost:11434/v1\`.

\`\`\`javascript
// Night City Cyberdeck Telemetry
function breachProtocol(target) {
  return {
    agent: "Capri (Edgerunners S2)",
    target,
    iceStatus: "BYPASSED",
    timestamp: new Date().toISOString()
  };
}
\`\`\``;
            const chunks = demoText.match(/.{1,5}(\s|$)|.{1,5}/gs) || [demoText];
            let acc = '';
            for (const chunk of chunks) {
              if (signal.aborted) return;
              await new Promise((r) => setTimeout(r, 22));
              acc += chunk;
              emitToken(chunk, acc);
            }
            completeListeners.forEach((fn) => fn({ requestId, fullResponse: acc }));
            return;
          }

          let acc = '';
          if (provider === 'gemini') {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
              model
            )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
            const contents = [
              ...history.slice(-8).map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
              })),
              { role: 'user', parts: [{ text: prompt }] }
            ];
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: sysPrompt }] },
                contents
              }),
              signal
            });
            if (!res.ok) throw new Error(await res.text());
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const lines = buf.split(/\r?\n/);
              buf = lines.pop() || '';
              for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                try {
                  const parsed = JSON.parse(line.slice(5).trim());
                  const parts = parsed.candidates?.[0]?.content?.parts || [];
                  for (const p of parts) {
                    if (p.text) {
                      acc += p.text;
                      emitToken(p.text, acc);
                    }
                  }
                } catch (_) {}
              }
            }
          } else if (provider === 'openai' || provider === 'local') {
            const base = (cfg.providers?.local?.endpoint || 'http://localhost:11434/v1').replace(/\/+$/, '');
            const endpoint =
              provider === 'openai'
                ? 'https://api.openai.com/v1/chat/completions'
                : base.endsWith('/chat/completions')
                ? base
                : `${base}/chat/completions`;
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            const res = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model: provider === 'local' ? cfg.providers?.local?.model || model : model,
                stream: true,
                messages: [
                  { role: 'system', content: sysPrompt },
                  ...history.slice(-8),
                  { role: 'user', content: prompt }
                ]
              }),
              signal
            });
            if (!res.ok) throw new Error(await res.text());
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const lines = buf.split(/\r?\n/);
              buf = lines.pop() || '';
              for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const d = line.slice(5).trim();
                if (d === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(d);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) {
                    acc += delta;
                    emitToken(delta, acc);
                  }
                } catch (_) {}
              }
            }
          } else if (provider === 'anthropic') {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
              },
              body: JSON.stringify({
                model,
                max_tokens: 2048,
                system: sysPrompt,
                stream: true,
                messages: [
                  ...history.slice(-8).map((m) => ({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: m.content
                  })),
                  { role: 'user', content: prompt }
                ]
              }),
              signal
            });
            if (!res.ok) throw new Error(await res.text());
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const lines = buf.split(/\r?\n/);
              buf = lines.pop() || '';
              for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                try {
                  const parsed = JSON.parse(line.slice(5).trim());
                  if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                    acc += parsed.delta.text;
                    emitToken(parsed.delta.text, acc);
                  }
                } catch (_) {}
              }
            }
          }

          completeListeners.forEach((fn) => fn({ requestId, fullResponse: acc }));
        } catch (err) {
          errorListeners.forEach((fn) =>
            fn({ requestId, error: err.name === 'AbortError' ? 'Aborted' : err.message })
          );
        }
      })();
    },
    cancelAIStream() {
      if (activeAbort) activeAbort.abort();
    },
    onStreamToken(fn) {
      tokenListeners.push(fn);
    },
    onStreamComplete(fn) {
      completeListeners.push(fn);
    },
    onStreamError(fn) {
      errorListeners.push(fn);
    },
    onSettingsUpdated(fn) {
      settingsListeners.push(fn);
    },
    onSummonHud() {},
    onOpenSettings() {}
  };
}

const bridge = window.capriBridge || createBrowserFallbackBridge();

// ============================================================================
// 2. DOM REFERENCES & STATE
// ============================================================================
const widgetRoot = document.getElementById('widget-root');
const capriStage = document.getElementById('capri-stage');
const animeSpriteContainer = document.getElementById('anime-sprite-container');
const svgSpriteContainer = document.getElementById('svg-sprite-container');
const stateLabel = document.getElementById('state-label');
const lockIndicator = document.getElementById('lock-indicator');

const speechBubble = document.getElementById('speech-bubble');
const speechBubbleText = document.getElementById('speech-bubble-text');
const bubbleCopyBtn = document.getElementById('bubble-copy-btn');

const cyberHud = document.getElementById('cyber-hud');
const quickModelSelect = document.getElementById('quick-model-select');
const openSettingsBtn = document.getElementById('open-settings-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const closeHudBtn = document.getElementById('close-hud-btn');
const copyResponseBtn = document.getElementById('copy-response-btn');
const copyBtnLabel = document.getElementById('copy-btn-label');
const hudOutput = document.getElementById('hud-output');
const hudInputForm = document.getElementById('hud-input-form');
const hudPromptInput = document.getElementById('hud-prompt-input');
const voiceBtn = document.getElementById('voice-btn');
const sendBtnText = document.getElementById('send-btn-text');

const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const saveAllSettingsBtn = document.getElementById('save-all-settings-btn');
const settingsFeedback = document.getElementById('settings-feedback');
const settingScale = document.getElementById('setting-scale');
const settingSpriteStyle = document.getElementById('setting-sprite-style');
const settingPersona = document.getElementById('setting-persona');
const settingLockPos = document.getElementById('setting-lock-pos');
const settingClickThrough = document.getElementById('setting-click-through');
const localEndpointInput = document.getElementById('local-endpoint-input');
const localModelInput = document.getElementById('local-model-input');
const fallbackContextMenu = document.getElementById('fallback-context-menu');

let appConfig = {};
let conversationHistory = [];
let latestAssistantResponse = '';
let activeRequestId = null;
let isStreaming = false;
let activeAssistantMsgEl = null;
let speechHideTimer = null;

// ============================================================================
// 3. VISUAL STATES CONTROLLER (Idle, Listening, Thinking, Speaking)
// ============================================================================
const STATE_LABELS = {
  idle: 'CAPRI // IDLE',
  listening: 'AUDIO // LISTENING...',
  thinking: 'ICE // BREACHING...',
  speaking: 'COMMS // TRANSMITTING'
};

function setVisualState(state) {
  widgetRoot.dataset.state = state;
  stateLabel.textContent = STATE_LABELS[state] || STATE_LABELS.idle;

  document.querySelectorAll('.state-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.previewState === state);
  });

  if (state === 'speaking') {
    speechBubble.classList.remove('hidden');
  }
}

// Allow manual testing of states via the HUD state chips
document.querySelectorAll('.state-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const targetState = chip.dataset.previewState;
    setVisualState(targetState);
    if (targetState === 'speaking' && !speechBubbleText.textContent.trim()) {
      runTypewriterInBubble("Yo choom! Comms channel is crystal clear. Ready to run your next daemon.");
    } else if (targetState !== 'speaking') {
      speechBubble.classList.add('hidden');
    }
  });
});

function runTypewriterInBubble(text) {
  speechBubble.classList.remove('hidden');
  speechBubbleText.textContent = '';
  const cleanPreview = text.replace(/```[\s\S]*?```/g, '[CODE BLOCK]').replace(/[#*_`]/g, '').trim();
  const truncated = cleanPreview.length > 180 ? cleanPreview.slice(0, 180) + '...' : cleanPreview;

  let i = 0;
  const interval = setInterval(() => {
    if (i < truncated.length) {
      speechBubbleText.textContent += truncated[i];
      i++;
    } else {
      clearInterval(interval);
    }
  }, 16);
}

// ============================================================================
// 4. CLEAN MARKDOWN RENDERER WITH SYNTAX CODE BLOCKS & COPY BUTTONS
// ============================================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(markdownText) {
  if (!markdownText) return '';

  const codeBlocks = [];
  // Extract fenced code blocks first
  let processed = markdownText.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length;
    const language = (lang || 'code').toUpperCase();
    const encodedCode = encodeURIComponent(code.replace(/\n$/, ''));
    codeBlocks.push(
      `<div class="code-block-wrapper">
        <div class="code-block-header">
          <span>${escapeHtml(language)}</span>
          <button type="button" class="code-copy-inline" data-code="${encodedCode}">COPY CODE</button>
        </div>
        <pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>
      </div>`
    );
    return `@@CODE_BLOCK_${idx}@@`;
  });

  // Escape remaining HTML
  processed = escapeHtml(processed);

  // Headings
  processed = processed
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Inline code, bold, italic
  processed = processed
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Unordered lists
  processed = processed.replace(/(?:^|\n)((?:[-*]\s+.+(?:\n|$))+)/g, (_m, listBlock) => {
    const items = listBlock
      .trim()
      .split(/\n/)
      .map((line) => `<li>${line.replace(/^[-*]\s+/, '')}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });

  // Paragraphs
  processed = processed
    .split(/\n{2,}/)
    .map((para) => {
      const trimmed = para.trim();
      if (!trimmed) return '';
      if (
        trimmed.startsWith('<h') ||
        trimmed.startsWith('<ul') ||
        trimmed.startsWith('@@CODE_BLOCK_')
      ) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('');

  // Restore code blocks
  processed = processed.replace(/@@CODE_BLOCK_(\d+)@@/g, (_m, idx) => codeBlocks[Number(idx)] || '');

  return processed;
}

// Event delegation for per-code-block copy buttons
hudOutput.addEventListener('click', (e) => {
  const btn = e.target.closest('.code-copy-inline');
  if (!btn) return;
  const rawCode = decodeURIComponent(btn.dataset.code || '');
  navigator.clipboard.writeText(rawCode).then(() => {
    const prev = btn.textContent;
    btn.textContent = 'COPIED // OK';
    setTimeout(() => {
      btn.textContent = prev;
    }, 1400);
  });
});

// ============================================================================
// 5. DRAGGABLE SPRITE + LEFT-CLICK HUD TOGGLE + DYNAMIC CLICK-THROUGH
// ============================================================================
let isDragging = false;
let dragMoved = false;
let dragStartScreenX = 0;
let dragStartScreenY = 0;

capriStage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // Only left mouse button
  isDragging = true;
  dragMoved = false;
  dragStartScreenX = e.screenX;
  dragStartScreenY = e.screenY;
});

window.addEventListener('mousemove', (e) => {
  // Dynamic transparent area click-through in Electron
  if (!isDragging) {
    const interactiveEl = e.target.closest('[data-interactive="true"]');
    bridge.setIgnoreMouseEvents(!interactiveEl);
    return;
  }

  const dx = e.screenX - dragStartScreenX;
  const dy = e.screenY - dragStartScreenY;

  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    dragMoved = true;
  }

  if (dragMoved && !appConfig.locked) {
    bridge.moveWindowBy(dx, dy);
    dragStartScreenX = e.screenX;
    dragStartScreenY = e.screenY;
  }
});

window.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;

  // If the user clicked Capri without dragging, toggle the Cyberpunk HUD modal!
  if (!dragMoved && e.button === 0 && e.target.closest('#capri-stage')) {
    toggleHudModal();
  }
});

// Right-Click Context Menu on Capri or HUD
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (bridge.isElectron) {
    bridge.showContextMenu();
  } else {
    fallbackContextMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 225)}px`;
    fallbackContextMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 240)}px`;
    fallbackContextMenu.classList.remove('hidden');
  }
});

window.addEventListener('click', (e) => {
  if (!e.target.closest('#fallback-context-menu')) {
    fallbackContextMenu.classList.add('hidden');
  }
});

fallbackContextMenu.addEventListener('click', async (e) => {
  const btn = e.target.closest('.ctx-item');
  if (!btn) return;
  const action = btn.dataset.action;
  fallbackContextMenu.classList.add('hidden');

  if (action === 'summon') summonAndFocusHud();
  if (action === 'toggle-lock') await bridge.updateSettings({ locked: !appConfig.locked });
  if (action === 'scale-small') await bridge.updateSettings({ scale: 'small' });
  if (action === 'scale-medium') await bridge.updateSettings({ scale: 'medium' });
  if (action === 'scale-large') await bridge.updateSettings({ scale: 'large' });
  if (action === 'toggle-sprite') {
    const nextStyle = appConfig.spriteStyle === 'cyber-svg' ? 'image' : 'cyber-svg';
    await bridge.updateSettings({ spriteStyle: nextStyle });
  }
  if (action === 'open-settings') openSettingsModal();
});

function toggleHudModal() {
  const isHidden = cyberHud.classList.toggle('hidden');
  if (!isHidden) {
    hudPromptInput.focus();
  }
}

function summonAndFocusHud() {
  cyberHud.classList.remove('hidden');
  hudPromptInput.focus();
  hudPromptInput.select();
}

closeHudBtn.addEventListener('click', () => {
  cyberHud.classList.add('hidden');
});

// Global Escape / Browser fallback Ctrl+Shift+Space
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
    e.preventDefault();
    summonAndFocusHud();
  } else if (e.key === 'Escape') {
    if (!settingsModal.classList.contains('hidden')) {
      settingsModal.classList.add('hidden');
    } else if (!cyberHud.classList.contains('hidden')) {
      cyberHud.classList.add('hidden');
    }
  }
});

// ============================================================================
// 6. VOICE INPUT (SPEECH-TO-TEXT TOGGLE)
// ============================================================================
let recognition = null;
let isRecordingVoice = false;

function initSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return null;

  const rec = new SpeechRec();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;

  rec.onstart = () => {
    isRecordingVoice = true;
    voiceBtn.classList.add('recording');
    setVisualState('listening');
    hudPromptInput.placeholder = 'Listening to voice comms...';
  };

  rec.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    hudPromptInput.value = transcript;
  };

  rec.onerror = () => {
    stopVoiceRecording();
  };

  rec.onend = () => {
    stopVoiceRecording();
  };

  return rec;
}

function stopVoiceRecording() {
  isRecordingVoice = false;
  voiceBtn.classList.remove('recording');
  hudPromptInput.placeholder = 'Transmit query to Capri... (Ctrl+Shift+Space)';
  if (!isStreaming) {
    setVisualState('idle');
  }
}

voiceBtn.addEventListener('click', () => {
  if (!recognition) {
    recognition = initSpeechRecognition();
  }

  if (isRecordingVoice) {
    if (recognition) recognition.stop();
    stopVoiceRecording();
    return;
  }

  if (recognition) {
    try {
      recognition.start();
    } catch (_) {
      stopVoiceRecording();
    }
  } else {
    // Visual listening pulse simulation if OS speech engine isn't attached
    isRecordingVoice = true;
    voiceBtn.classList.add('recording');
    setVisualState('listening');
    hudPromptInput.placeholder = 'Voice pulse active (type or click mic to stop)...';
    setTimeout(() => {
      if (isRecordingVoice) stopVoiceRecording();
    }, 4000);
  }
});

// ============================================================================
// 7. AI QUERY STREAMING & OUTPUT DISPLAY
// ============================================================================
function appendChatMessage(role, content, metaLabel) {
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${role === 'user' ? 'user-msg' : 'assistant-msg'}`;

  const metaEl = document.createElement('div');
  metaEl.className = 'transmission-meta';
  metaEl.innerHTML = `<span>${escapeHtml(metaLabel)}</span><span>${new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })}</span>`;

  const bodyEl = document.createElement('div');
  bodyEl.className = 'md-content';
  bodyEl.innerHTML = role === 'user' ? `<p>${escapeHtml(content)}</p>` : renderMarkdown(content);

  msgEl.appendChild(metaEl);
  msgEl.appendChild(bodyEl);
  hudOutput.appendChild(msgEl);
  hudOutput.scrollTop = hudOutput.scrollHeight;
  return bodyEl;
}

hudInputForm.addEventListener('submit', (e) => {
  e.preventDefault();

  if (isStreaming) {
    bridge.cancelAIStream();
    finishStreamingState('idle');
    return;
  }

  const prompt = hudPromptInput.value.trim();
  if (!prompt) return;

  hudPromptInput.value = '';
  const [selectedProvider, selectedModel] = (quickModelSelect.value || 'gemini::gemini-1.5-pro').split('::');

  appendChatMessage('user', prompt, 'USER // INPUT');
  activeAssistantMsgEl = appendChatMessage(
    'assistant',
    '_Establishing neural link..._',
    `CAPRI // ${selectedProvider.toUpperCase()} :: ${selectedModel}`
  );

  isStreaming = true;
  sendBtnText.textContent = 'STOP';
  setVisualState('thinking');
  speechBubble.classList.remove('hidden');
  speechBubbleText.textContent = 'Decrypting ICE & routing query...';

  activeRequestId = `req_${Date.now()}`;
  bridge.startAIStream({
    requestId: activeRequestId,
    prompt,
    history: conversationHistory,
    overrideProvider: selectedProvider,
    overrideModel: selectedModel
  });

  conversationHistory.push({ role: 'user', content: prompt });
});

bridge.onStreamToken(({ requestId, accumulated }) => {
  if (requestId !== activeRequestId) return;

  if (widgetRoot.dataset.state !== 'speaking') {
    setVisualState('speaking');
  }

  latestAssistantResponse = accumulated;
  if (activeAssistantMsgEl) {
    activeAssistantMsgEl.innerHTML = renderMarkdown(accumulated);
    hudOutput.scrollTop = hudOutput.scrollHeight;
  }

  // Update floating dialogue bubble with live typewriter preview
  const cleanText = accumulated.replace(/```[\s\S]*?```/g, '[CODE]').replace(/[#*_`]/g, '').trim();
  speechBubbleText.textContent = cleanText.slice(-175);
});

bridge.onStreamComplete(({ requestId, fullResponse }) => {
  if (requestId !== activeRequestId) return;
  latestAssistantResponse = fullResponse;
  if (activeAssistantMsgEl) {
    activeAssistantMsgEl.innerHTML = renderMarkdown(fullResponse);
    hudOutput.scrollTop = hudOutput.scrollHeight;
  }
  conversationHistory.push({ role: 'assistant', content: fullResponse });
  finishStreamingState('speaking');

  clearTimeout(speechHideTimer);
  speechHideTimer = setTimeout(() => {
    if (!isStreaming) {
      setVisualState('idle');
      speechBubble.classList.add('hidden');
    }
  }, 7500);
});

bridge.onStreamError(({ requestId, error }) => {
  if (requestId !== activeRequestId) return;
  if (activeAssistantMsgEl) {
    activeAssistantMsgEl.innerHTML = renderMarkdown(`**// NEURAL LINK ERROR**\n\`${error}\``);
  }
  speechBubbleText.textContent = `ERR // ${error}`;
  finishStreamingState('idle');
});

function finishStreamingState(nextState = 'idle') {
  isStreaming = false;
  sendBtnText.textContent = 'SEND';
  setVisualState(nextState);
}

// Copy to Clipboard buttons
function copyLatestToClipboard(triggerButtonEl, labelEl) {
  const textToCopy = latestAssistantResponse || speechBubbleText.textContent || '';
  if (!textToCopy.trim()) return;
  navigator.clipboard.writeText(textToCopy).then(() => {
    const target = labelEl || triggerButtonEl;
    const prev = target.textContent;
    target.textContent = 'COPIED // OK';
    setTimeout(() => {
      target.textContent = prev;
    }, 1500);
  });
}

copyResponseBtn.addEventListener('click', () => copyLatestToClipboard(copyResponseBtn, copyBtnLabel));
bubbleCopyBtn.addEventListener('click', () => copyLatestToClipboard(bubbleCopyBtn, null));

clearChatBtn.addEventListener('click', () => {
  conversationHistory = [];
  latestAssistantResponse = '';
  hudOutput.innerHTML = `
    <div class="welcome-transmission">
      <div class="transmission-meta">MEMORY_BUFFER // PURGED</div>
      <p>Neural log cleared, choom. Ready for a fresh run.</p>
    </div>
  `;
  speechBubble.classList.add('hidden');
  setVisualState('idle');
});

// ============================================================================
// 8. SETTINGS & CONFIGURABLE API HUB
// ============================================================================
function applyConfigToUI(config, keysStatus = {}) {
  appConfig = config || {};

  // Scale size
  widgetRoot.classList.remove('scale-small', 'scale-medium', 'scale-large');
  widgetRoot.classList.add(`scale-${config.scale || 'medium'}`);
  settingScale.value = config.scale || 'medium';

  // Sprite style (Generated Edgerunners Anime Sprite vs Holo-Vector SVG)
  const useSvg = config.spriteStyle === 'cyber-svg';
  animeSpriteContainer.classList.toggle('hidden', useSvg);
  svgSpriteContainer.classList.toggle('hidden', !useSvg);
  settingSpriteStyle.value = config.spriteStyle || 'image';

  // Lock & Click-Through indicators
  lockIndicator.classList.toggle('hidden', !config.locked);
  settingLockPos.checked = Boolean(config.locked);
  settingClickThrough.checked = Boolean(config.clickThrough);
  settingPersona.value = config.personaMode || 'edgerunner';

  // Local LLM settings
  if (config.providers?.local) {
    localEndpointInput.value = config.providers.local.endpoint || 'http://localhost:11434/v1';
    localModelInput.value = config.providers.local.model || 'llama3.2';
  }

  // Sync Quick Model Dropdown
  const activeProvider = config.activeProvider || 'gemini';
  const activeModel = config.activeModel || config.providers?.[activeProvider]?.model || 'gemini-1.5-pro';
  const compositeVal = `${activeProvider}::${activeModel}`;
  if ([...quickModelSelect.options].some((o) => o.value === compositeVal)) {
    quickModelSelect.value = compositeVal;
  }

  // Update Keychain Status Badges
  for (const provider of ['gemini', 'openai', 'anthropic']) {
    const badge = document.getElementById(`key-badge-${provider}`);
    if (!badge) continue;
    const status = keysStatus[provider];
    if (status && status.hasKey) {
      badge.textContent = `ENCRYPTED (${status.masked})`;
      badge.classList.add('configured');
    } else {
      badge.textContent = 'UNSET';
      badge.classList.remove('configured');
    }
  }
}

quickModelSelect.addEventListener('change', async () => {
  const [provider, model] = quickModelSelect.value.split('::');
  const { config, keysStatus } = await bridge.updateSettings({
    activeProvider: provider,
    activeModel: model
  });
  applyConfigToUI(config, keysStatus);
});

function openSettingsModal() {
  settingsModal.classList.remove('hidden');
}

openSettingsBtn.addEventListener('click', openSettingsModal);
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

// Save individual API keys into OS Keychain / DPAPI Vault
document.querySelectorAll('.cyber-save-key-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const provider = btn.dataset.provider;
    const input = document.getElementById(`key-input-${provider}`);
    if (!input) return;

    const { config, keysStatus } = await bridge.setApiKey(provider, input.value);
    input.value = '';
    applyConfigToUI(config, keysStatus);
    settingsFeedback.textContent = `${provider.toUpperCase()} key stored in encrypted vault!`;
  });
});

saveAllSettingsBtn.addEventListener('click', async () => {
  const nextProviders = {
    ...(appConfig.providers || {}),
    local: {
      endpoint: localEndpointInput.value.trim() || 'http://localhost:11434/v1',
      model: localModelInput.value.trim() || 'llama3.2'
    }
  };

  const { config, keysStatus } = await bridge.updateSettings({
    scale: settingScale.value,
    spriteStyle: settingSpriteStyle.value,
    personaMode: settingPersona.value,
    locked: settingLockPos.checked,
    clickThrough: settingClickThrough.checked,
    providers: nextProviders
  });

  applyConfigToUI(config, keysStatus);
  settingsFeedback.textContent = 'Configuration synced!';
  setTimeout(() => {
    settingsModal.classList.add('hidden');
  }, 450);
});

// Listen for Main Process Tray / Global Shortcut events
bridge.onSettingsUpdated(({ config, keysStatus }) => {
  applyConfigToUI(config, keysStatus);
});

bridge.onSummonHud(() => {
  summonAndFocusHud();
});

bridge.onOpenSettings(() => {
  openSettingsModal();
});

// Initial Bootstrap
(async function initCapriWidget() {
  const { config, keysStatus } = await bridge.getSettings();
  applyConfigToUI(config, keysStatus);
})();
