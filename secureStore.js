const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { app, safeStorage } = require('electron');

const DEFAULT_SETTINGS = {
  windowBounds: {
    x: null,
    y: null
  },
  scale: 'medium', // 'small' (0.75), 'medium' (1.0), 'large' (1.25)
  locked: false,
  clickThrough: false,
  alwaysOnTop: true,
  spriteStyle: 'image', // 'image' (generated sprite) | 'cyber-svg' (vector rig)
  personaMode: 'edgerunner', // 'edgerunner' | 'technical'
  activeProvider: 'gemini', // 'openai' | 'anthropic' | 'gemini' | 'local'
  activeModel: 'gemini-1.5-pro',
  providers: {
    openai: {
      model: 'gpt-4o',
      availableModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini']
    },
    anthropic: {
      model: 'claude-3-5-sonnet-latest',
      availableModels: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest']
    },
    gemini: {
      model: 'gemini-1.5-pro',
      availableModels: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash']
    },
    local: {
      endpoint: 'http://localhost:11434/v1',
      model: 'llama3.2',
      availableModels: ['llama3.2', 'qwen2.5-coder', 'deepseek-r1', 'mistral']
    }
  }
};

class SecureConfigStore {
  constructor() {
    const userDataPath = app ? app.getPath('userData') : path.join(os.homedir(), '.capri-widget');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    this.configPath = path.join(userDataPath, 'capri-config.json');
    this.secretsPath = path.join(userDataPath, 'capri-vault.enc');
    this.state = this._loadConfig();
    this.secretsCache = this._loadSecrets();
  }

  _getFallbackCipherKey() {
    const machineSeed = `${os.hostname()}-${os.userInfo().username}-capri-edgerunner-s2-vault`;
    return crypto.createHash('sha256').update(machineSeed).digest();
  }

  _loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          providers: {
            ...DEFAULT_SETTINGS.providers,
            ...(parsed.providers || {})
          }
        };
      }
    } catch (err) {
      console.error('[SecureStore] Failed to load config, using defaults:', err.message);
    }
    return structuredClone(DEFAULT_SETTINGS);
  }

  saveConfig(partial = {}) {
    this.state = {
      ...this.state,
      ...partial,
      providers: {
        ...this.state.providers,
        ...(partial.providers || {})
      }
    };
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SecureStore] Failed to save config:', err.message);
    }
    return this.state;
  }

  getConfig() {
    return this.state;
  }

  _loadSecrets() {
    try {
      if (!fs.existsSync(this.secretsPath)) {
        return {};
      }
      const payload = JSON.parse(fs.readFileSync(this.secretsPath, 'utf-8'));
      const decrypted = {};

      for (const [provider, record] of Object.entries(payload)) {
        if (!record || !record.data) continue;
        if (record.scheme === 'os-keychain' && safeStorage && safeStorage.isEncryptionAvailable()) {
          const buf = Buffer.from(record.data, 'base64');
          decrypted[provider] = safeStorage.decryptString(buf);
        } else if (record.scheme === 'aes-256-gcm') {
          const iv = Buffer.from(record.iv, 'base64');
          const authTag = Buffer.from(record.tag, 'base64');
          const encryptedBuf = Buffer.from(record.data, 'base64');
          const decipher = crypto.createDecipheriv('aes-256-gcm', this._getFallbackCipherKey(), iv);
          decipher.setAuthTag(authTag);
          const out = Buffer.concat([decipher.update(encryptedBuf), decipher.final()]);
          decrypted[provider] = out.toString('utf-8');
        }
      }
      return decrypted;
    } catch (err) {
      console.error('[SecureStore] Failed to load encrypted API keys:', err.message);
      return {};
    }
  }

  _persistSecrets() {
    try {
      const serialized = {};
      const useOsKeychain = safeStorage && safeStorage.isEncryptionAvailable();

      for (const [provider, plainKey] of Object.entries(this.secretsCache)) {
        if (!plainKey) continue;
        if (useOsKeychain) {
          const encryptedBuf = safeStorage.encryptString(plainKey);
          serialized[provider] = {
            scheme: 'os-keychain',
            data: encryptedBuf.toString('base64')
          };
        } else {
          const iv = crypto.randomBytes(12);
          const cipher = crypto.createCipheriv('aes-256-gcm', this._getFallbackCipherKey(), iv);
          const encryptedBuf = Buffer.concat([cipher.update(plainKey, 'utf-8'), cipher.final()]);
          const authTag = cipher.getAuthTag();
          serialized[provider] = {
            scheme: 'aes-256-gcm',
            iv: iv.toString('base64'),
            tag: authTag.toString('base64'),
            data: encryptedBuf.toString('base64')
          };
        }
      }

      fs.writeFileSync(this.secretsPath, JSON.stringify(serialized, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SecureStore] Failed to persist encrypted API keys:', err.message);
    }
  }

  setApiKey(provider, apiKey) {
    if (!apiKey || !apiKey.trim()) {
      delete this.secretsCache[provider];
    } else {
      this.secretsCache[provider] = apiKey.trim();
    }
    this._persistSecrets();
  }

  getApiKey(provider) {
    // Allow environment variable override if not set in UI vault
    const envMap = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      local: process.env.LOCAL_LLM_API_KEY || ''
    };
    return this.secretsCache[provider] || envMap[provider] || '';
  }

  getMaskedKeysStatus() {
    const result = {};
    for (const provider of ['openai', 'anthropic', 'gemini', 'local']) {
      const key = this.getApiKey(provider);
      result[provider] = {
        hasKey: Boolean(key && key.length > 0),
        masked: key && key.length > 8
          ? `${key.slice(0, 4)}••••••••${key.slice(-4)}`
          : (key ? '••••••••' : '')
      };
    }
    return result;
  }
}

module.exports = { SecureConfigStore, DEFAULT_SETTINGS };
