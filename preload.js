const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capriBridge', {
  isElectron: true,

  // Settings & Secure Keychain Vault
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partialConfig) => ipcRenderer.invoke('settings:update', partialConfig),
  setApiKey: (provider, apiKey) => ipcRenderer.invoke('settings:set-api-key', { provider, apiKey }),

  // Window & Overlay Controls
  moveWindowBy: (dx, dy) => ipcRenderer.send('window:move-by', { dx, dy }),
  setIgnoreMouseEvents: (shouldIgnore) => ipcRenderer.send('window:set-ignore-mouse', shouldIgnore),
  showContextMenu: () => ipcRenderer.send('window:show-context-menu'),

  // AI Router Streaming
  startAIStream: (payload) => ipcRenderer.send('ai:stream-start', payload),
  cancelAIStream: () => ipcRenderer.send('ai:stream-cancel'),

  // Event Subscriptions
  onStreamToken: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ai:stream-token', handler);
    return () => ipcRenderer.removeListener('ai:stream-token', handler);
  },
  onStreamComplete: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ai:stream-complete', handler);
    return () => ipcRenderer.removeListener('ai:stream-complete', handler);
  },
  onStreamError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ai:stream-error', handler);
    return () => ipcRenderer.removeListener('ai:stream-error', handler);
  },
  onSettingsUpdated: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('settings:updated', handler);
    return () => ipcRenderer.removeListener('settings:updated', handler);
  },
  onSummonHud: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ui:summon-hud', handler);
    return () => ipcRenderer.removeListener('ui:summon-hud', handler);
  },
  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ui:open-settings', handler);
    return () => ipcRenderer.removeListener('ui:open-settings', handler);
  }
});
