const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notesAPI', {
  // ─── Notes CRUD ─────────────────────────────────────────────────────────
  getNotes: () => ipcRenderer.invoke('notes:getAll'),
  getNote: (id) => ipcRenderer.invoke('notes:get', id),
  saveNote: (note) => ipcRenderer.invoke('notes:save', note),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id),
  togglePin: (id) => ipcRenderer.invoke('notes:togglePin', id),

  // ─── Settings ───────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // ─── Window Controls ───────────────────────────────────────────────────
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),

  // ─── Notion Sync ──────────────────────────────────────────────────────
  getSyncStatus: () => ipcRenderer.invoke('notion:syncStatus'),
  testNotionConnection: () => ipcRenderer.invoke('notion:testConnection'),
  pullFromNotion: () => ipcRenderer.invoke('notion:pull'),
  fullSync: () => ipcRenderer.invoke('notion:fullSync'),
});
