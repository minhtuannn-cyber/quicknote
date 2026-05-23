const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
} = require('electron');
const path = require('path');
const dataStore = require('./store');

// Prevent garbage collection
let mainWindow = null;
let tray = null;
let isQuitting = false;

// ─── Window Creation ────────────────────────────────────────────────────────────

function createWindow() {
  const settings = dataStore.getSettings();
  const bounds = settings.windowBounds || {};

  mainWindow = new BrowserWindow({
    width: bounds.width || 380,
    height: bounds.height || 520,
    x: bounds.x,
    y: bounds.y,
    minWidth: 300,
    minHeight: 350,
    frame: false,
    transparent: true,
    alwaysOnTop: settings.alwaysOnTop !== false,
    skipTaskbar: true,
    resizable: true,
    show: false, // Show after ready-to-show
    hasShadow: true,
    vibrancy: 'under-window', // macOS native blur
    visualEffectState: 'active',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 }, // Hide traffic lights
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    },
  });

  mainWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'index.html')
  );

  // Show window gracefully after content loaded
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Set floating level to stay above ALL other windows on macOS
    if (settings.alwaysOnTop !== false) {
      mainWindow.setAlwaysOnTop(true, 'floating');
    }

    // Show on all workspaces/desktops (macOS Spaces)
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  });

  // Save window position and size on move/resize
  mainWindow.on('moved', saveWindowBounds);
  mainWindow.on('resized', saveWindowBounds);

  // Hide instead of close (keep in tray)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function saveWindowBounds() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  dataStore.saveSettings({
    windowBounds: {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
    },
  });
}

// ─── Toggle Window Visibility ───────────────────────────────────────────────────

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ─── System Tray ────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'trayIconTemplate.png');

  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    // Resize for tray (16x16 for standard, macOS will use @2x automatically)
    icon = icon.resize({ width: 16, height: 16 });
  } catch (e) {
    // Fallback: create a simple icon programmatically
    icon = createFallbackTrayIcon();
  }

  tray = new Tray(icon);
  tray.setToolTip('QuickNote — Cmd+Shift+N');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '📝 Show/Hide Notes',
      click: toggleWindow,
      accelerator: 'CommandOrControl+Shift+N',
    },
    { type: 'separator' },
    {
      label: '📌 Always on Top',
      type: 'checkbox',
      checked: dataStore.getSettings().alwaysOnTop !== false,
      click: (menuItem) => {
        if (mainWindow) {
          mainWindow.setAlwaysOnTop(menuItem.checked, 'floating');
          mainWindow.setVisibleOnAllWorkspaces(menuItem.checked, { visibleOnFullScreen: menuItem.checked });
        }
        dataStore.saveSettings({ alwaysOnTop: menuItem.checked });
      },
    },
    { type: 'separator' },
    {
      label: '🚪 Quit QuickNote',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Click tray icon to toggle window
  tray.on('click', toggleWindow);
}

function createFallbackTrayIcon() {
  // Create a simple 32x32 icon as fallback
  const size = 32;
  const canvas = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const inCircle =
        Math.pow(x - size / 2, 2) + Math.pow(y - size / 2, 2) <
        Math.pow(size / 2 - 2, 2);
      canvas[idx] = inCircle ? 255 : 0; // R
      canvas[idx + 1] = inCircle ? 255 : 0; // G
      canvas[idx + 2] = inCircle ? 255 : 0; // B
      canvas[idx + 3] = inCircle ? 255 : 0; // A
    }
  }
  return nativeImage.createFromBuffer(canvas, {
    width: size,
    height: size,
  });
}

// ─── Global Shortcut ────────────────────────────────────────────────────────────

function registerGlobalShortcut() {
  const shortcut = 'CommandOrControl+Shift+N';
  const registered = globalShortcut.register(shortcut, toggleWindow);

  if (!registered) {
    console.error(
      `Failed to register global shortcut: ${shortcut}. It may be used by another app.`
    );
  }
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.handle('notes:getAll', () => {
    return dataStore.getNotes();
  });

  ipcMain.handle('notes:get', (_event, id) => {
    return dataStore.getNote(id);
  });

  ipcMain.handle('notes:save', (_event, note) => {
    return dataStore.saveNote(note);
  });

  ipcMain.handle('notes:delete', (_event, id) => {
    return dataStore.deleteNote(id);
  });

  ipcMain.handle('notes:togglePin', (_event, id) => {
    return dataStore.togglePin(id);
  });

  ipcMain.handle('settings:get', () => {
    return dataStore.getSettings();
  });

  ipcMain.handle('settings:save', (_event, settings) => {
    return dataStore.saveSettings(settings);
  });

  ipcMain.handle('window:hide', () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window:toggleAlwaysOnTop', () => {
    if (mainWindow) {
      const isOnTop = !mainWindow.isAlwaysOnTop();
      mainWindow.setAlwaysOnTop(isOnTop, 'floating');
      mainWindow.setVisibleOnAllWorkspaces(isOnTop, { visibleOnFullScreen: isOnTop });
      dataStore.saveSettings({ alwaysOnTop: isOnTop });
      return isOnTop;
    }
    return false;
  });

  // ─── Notion Sync Handlers ───────────────────────────────────────────────
  ipcMain.handle('notion:syncStatus', () => {
    return dataStore.getSyncStatus();
  });

  ipcMain.handle('notion:testConnection', async () => {
    return await dataStore.testNotionConnection();
  });

  ipcMain.handle('notion:pull', async () => {
    return await dataStore.pullFromNotion();
  });

  ipcMain.handle('notion:fullSync', async () => {
    return await dataStore.fullSync();
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();
  createTray();
  registerGlobalShortcut();
  registerIpcHandlers();

  // Auto-sync from Notion on startup (non-blocking)
  try {
    const connectionTest = await dataStore.testNotionConnection();
    if (connectionTest.success) {
      // Flush any offline queue first, then pull updates
      await dataStore.fullSync();
    }
  } catch (err) {
    console.error('[Startup] Auto-sync failed:', err.message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
