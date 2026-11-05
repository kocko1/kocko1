const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  screen,
  nativeImage
} = require('electron');
const { SecureConfigStore } = require('./secureStore');
const { routeAIQuery } = require('../services/aiRouter');

let mainWindow = null;
let tray = null;
let configStore = null;
let activeAbortController = null;

const WINDOW_WIDTH = 460;
const WINDOW_HEIGHT = 760;

/**
 * Ensures saved coordinates are still visible on at least one connected display
 * across multi-monitor setups.
 */
function resolveSafeWindowPosition(savedBounds) {
  const displays = screen.getAllDisplays();
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;

  if (
    savedBounds &&
    typeof savedBounds.x === 'number' &&
    typeof savedBounds.y === 'number'
  ) {
    const centerX = savedBounds.x + WINDOW_WIDTH / 2;
    const centerY = savedBounds.y + WINDOW_HEIGHT / 2;

    const isOnAnyDisplay = displays.some((d) => {
      const b = d.bounds;
      return (
        centerX >= b.x &&
        centerX <= b.x + b.width &&
        centerY >= b.y &&
        centerY <= b.y + b.height
      );
    });

    if (isOnAnyDisplay) {
      return { x: savedBounds.x, y: savedBounds.y };
    }
  }

  // Default to bottom-right corner of primary display
  return {
    x: primaryWorkArea.x + primaryWorkArea.width - WINDOW_WIDTH - 32,
    y: primaryWorkArea.y + primaryWorkArea.height - WINDOW_HEIGHT - 24
  };
}

function createMainWindow() {
  const config = configStore.getConfig();
  const { x, y } = resolveSafeWindowPosition(config.windowBounds);

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Keep pinned above standard desktop windows across multi-monitor setups
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (config.clickThrough) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  // Persist screen position whenever moved
  mainWindow.on('moved', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [newX, newY] = mainWindow.getPosition();
    configStore.saveConfig({ windowBounds: { x: newX, y: newY } });
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function buildContextMenuTemplate() {
  const config = configStore.getConfig();

  return [
    {
      label: 'CAPRI // EDGERUNNER OS v2.4',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Summon / Focus HUD (Ctrl+Shift+Space)',
      click: () => summonHudInput()
    },
    {
      label: 'Click-Through Mode (Ignore Clicks)',
      type: 'checkbox',
      checked: Boolean(config.clickThrough),
      click: (menuItem) => {
        setClickThroughMode(menuItem.checked);
      }
    },
    {
      label: 'Lock Position',
      type: 'checkbox',
      checked: Boolean(config.locked),
      click: (menuItem) => {
        const updated = configStore.saveConfig({ locked: menuItem.checked });
        broadcastConfigUpdate(updated);
        refreshTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: 'Scale Size',
      submenu: [
        {
          label: 'Small (75%)',
          type: 'radio',
          checked: config.scale === 'small',
          click: () => updateScale('small')
        },
        {
          label: 'Medium (100%)',
          type: 'radio',
          checked: config.scale === 'medium',
          click: () => updateScale('medium')
        },
        {
          label: 'Large (125%)',
          type: 'radio',
          checked: config.scale === 'large',
          click: () => updateScale('large')
        }
      ]
    },
    {
      label: 'Sprite Renderer',
      submenu: [
        {
          label: 'Edgerunner Anime Sprite (Capri)',
          type: 'radio',
          checked: config.spriteStyle !== 'cyber-svg',
          click: () => {
            const updated = configStore.saveConfig({ spriteStyle: 'image' });
            broadcastConfigUpdate(updated);
            refreshTrayMenu();
          }
        },
        {
          label: 'Holo-Vector Cyber Rig (SVG)',
          type: 'radio',
          checked: config.spriteStyle === 'cyber-svg',
          click: () => {
            const updated = configStore.saveConfig({ spriteStyle: 'cyber-svg' });
            broadcastConfigUpdate(updated);
            refreshTrayMenu();
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Configure AI Providers (⚙ Settings)',
      click: () => {
        if (config.clickThrough) {
          setClickThroughMode(false);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('ui:open-settings');
        }
      }
    },
    {
      label: 'Reset Position to Primary Screen',
      click: () => {
        const pos = resolveSafeWindowPosition(null);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setPosition(pos.x, pos.y);
        }
        configStore.saveConfig({ windowBounds: pos });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Capri Widget',
      click: () => {
        app.quit();
      }
    }
  ];
}

function updateScale(scale) {
  const updated = configStore.saveConfig({ scale });
  broadcastConfigUpdate(updated);
  refreshTrayMenu();
}

function setClickThroughMode(enabled) {
  const updated = configStore.saveConfig({ clickThrough: Boolean(enabled) });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(Boolean(enabled), { forward: true });
  }
  broadcastConfigUpdate(updated);
  refreshTrayMenu();
}

function broadcastConfigUpdate(updatedConfig) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:updated', {
      config: updatedConfig,
      keysStatus: configStore.getMaskedKeysStatus()
    });
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate(buildContextMenuTemplate());
  tray.setContextMenu(menu);
}

function createSystemTray() {
  const iconPath = path.join(__dirname, '../../assets/capri-sprite.png');
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Capri // Cyberpunk Edgerunners AI Companion');
  refreshTrayMenu();

  tray.on('click', () => {
    summonHudInput();
  });
}

function summonHudInput() {
  const config = configStore.getConfig();
  if (config.clickThrough) {
    setClickThroughMode(false);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('ui:summon-hud');
  }
}

function registerGlobalShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    summonHudInput();
  });
}

function registerIpcHandlers() {
  ipcMain.handle('settings:get', () => {
    return {
      config: configStore.getConfig(),
      keysStatus: configStore.getMaskedKeysStatus()
    };
  });

  ipcMain.handle('settings:update', (_event, partialConfig) => {
    const updated = configStore.saveConfig(partialConfig);
    if (typeof partialConfig.clickThrough === 'boolean') {
      setClickThroughMode(partialConfig.clickThrough);
    } else {
      broadcastConfigUpdate(updated);
      refreshTrayMenu();
    }
    return {
      config: updated,
      keysStatus: configStore.getMaskedKeysStatus()
    };
  });

  ipcMain.handle('settings:set-api-key', (_event, { provider, apiKey }) => {
    configStore.setApiKey(provider, apiKey);
    return {
      config: configStore.getConfig(),
      keysStatus: configStore.getMaskedKeysStatus()
    };
  });

  // Dynamic mouse hit-testing so transparent regions around Capri let desktop clicks pass through
  ipcMain.on('window:set-ignore-mouse', (_event, shouldIgnore) => {
    const config = configStore.getConfig();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (config.clickThrough) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
      return;
    }
    mainWindow.setIgnoreMouseEvents(Boolean(shouldIgnore), { forward: true });
  });

  // Smooth custom window dragging across multi-monitor setups
  ipcMain.on('window:move-by', (_event, { dx, dy }) => {
    const config = configStore.getConfig();
    if (config.locked || !mainWindow || mainWindow.isDestroyed()) return;
    const [x, y] = mainWindow.getPosition();
    const nextX = Math.round(x + dx);
    const nextY = Math.round(y + dy);
    mainWindow.setPosition(nextX, nextY);
    configStore.saveConfig({ windowBounds: { x: nextX, y: nextY } });
  });

  // Native right-click context menu on Capri or HUD
  ipcMain.on('window:show-context-menu', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const menu = Menu.buildFromTemplate(buildContextMenuTemplate());
    menu.popup({ window: mainWindow });
  });

  // AI Streaming Router IPC
  ipcMain.on('ai:stream-start', async (event, { requestId, prompt, history, overrideProvider, overrideModel }) => {
    if (activeAbortController) {
      activeAbortController.abort();
    }
    activeAbortController = new AbortController();

    const config = configStore.getConfig();
    const provider = overrideProvider || config.activeProvider || 'gemini';
    const providerCfg = config.providers?.[provider] || {};
    const model = overrideModel || config.activeModel || providerCfg.model;
    const apiKey = configStore.getApiKey(provider);
    const localEndpoint = config.providers?.local?.endpoint || 'http://localhost:11434/v1';

    try {
      const fullResponse = await routeAIQuery({
        provider,
        model,
        apiKey,
        localEndpoint,
        personaMode: config.personaMode || 'edgerunner',
        history: history || [],
        prompt,
        signal: activeAbortController.signal,
        onToken: (delta, accumulated) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('ai:stream-token', {
              requestId,
              delta,
              accumulated
            });
          }
        }
      });

      if (!event.sender.isDestroyed()) {
        event.sender.send('ai:stream-complete', {
          requestId,
          fullResponse
        });
      }
    } catch (err) {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai:stream-error', {
          requestId,
          error: err.name === 'AbortError' ? 'Transmission aborted by user.' : err.message
        });
      }
    } finally {
      activeAbortController = null;
    }
  });

  ipcMain.on('ai:stream-cancel', () => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  });
}

app.whenReady().then(() => {
  configStore = new SecureConfigStore();
  registerIpcHandlers();
  createMainWindow();
  createSystemTray();
  registerGlobalShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
