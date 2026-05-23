const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const notion = require('./notion');

// ─── Storage File Path ──────────────────────────────────────────────────────────

const DATA_DIR = path.join(app.getPath('userData'), 'quicknote-data');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const OFFLINE_QUEUE_FILE = path.join(DATA_DIR, 'offline-queue.json');

const DEFAULT_SETTINGS = {
  theme: 'dark',
  alwaysOnTop: true,
  windowBounds: { width: 380, height: 520 },
  notionApiKey: '',
  notionDatabaseId: '',
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── Generic JSON Read/Write ────────────────────────────────────────────────────

function readJSON(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e);
  }
  return defaultValue;
}

function writeJSON(filePath, data) {
  try {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error(`Error writing ${filePath}:`, e);
  }
}

// Initialize Notion config from settings on startup
const initialSettings = readJSON(SETTINGS_FILE, DEFAULT_SETTINGS);
notion.setConfig(initialSettings.notionApiKey || '', initialSettings.notionDatabaseId || '');

// ─── ID Generator ───────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Sync Status ────────────────────────────────────────────────────────────────

let lastSyncStatus = { syncing: false, error: null, lastSyncAt: null, detail: '' };

function setSyncStatus(syncing, error, detail) {
  lastSyncStatus = {
    syncing,
    error,
    lastSyncAt: !syncing && !error ? new Date().toISOString() : lastSyncStatus.lastSyncAt,
    detail: detail || '',
  };
}

function getSyncStatus() {
  return lastSyncStatus;
}

// ─── Offline Queue ──────────────────────────────────────────────────────────────

function getOfflineQueue() {
  return readJSON(OFFLINE_QUEUE_FILE, []);
}

function addToOfflineQueue(action, noteData) {
  const queue = getOfflineQueue();
  // Avoid duplicates for the same note (keep latest)
  const filtered = queue.filter((item) => !(item.noteId === noteData.id && item.action === action));
  filtered.push({
    action, // 'save' or 'delete'
    noteId: noteData.id,
    noteData,
    queuedAt: new Date().toISOString(),
  });
  writeJSON(OFFLINE_QUEUE_FILE, filtered);
  console.log(`[Offline] Queued ${action} for note: ${noteData.id}`);
}

function clearOfflineQueue() {
  writeJSON(OFFLINE_QUEUE_FILE, []);
}

async function flushOfflineQueue() {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { flushed: 0, errors: 0 };

  console.log(`[Offline] Flushing ${queue.length} queued operations...`);
  let flushed = 0;
  let errors = 0;

  for (const item of queue) {
    try {
      if (item.action === 'save') {
        const result = await notion.syncNote(item.noteData);
        if (result.success) {
          // Update notionPageId if it was newly created
          if (result.notionPageId && !item.noteData.notionPageId) {
            const notes = readJSON(NOTES_FILE, []);
            const idx = notes.findIndex((n) => n.id === item.noteId);
            if (idx >= 0) {
              notes[idx].notionPageId = result.notionPageId;
              writeJSON(NOTES_FILE, notes);
            }
          }
          flushed++;
        } else {
          errors++;
        }
      } else if (item.action === 'delete') {
        if (item.noteData.notionPageId) {
          await notion.deleteNotionNote(item.noteData.notionPageId);
        }
        flushed++;
      }
    } catch (err) {
      console.error(`[Offline] Error flushing ${item.action}:`, err.message);
      errors++;
    }
  }

  if (errors === 0) {
    clearOfflineQueue();
  } else {
    // Remove only successfully flushed items
    const remaining = queue.slice(flushed);
    writeJSON(OFFLINE_QUEUE_FILE, remaining);
  }

  console.log(`[Offline] Flushed: ${flushed}, Errors: ${errors}`);
  return { flushed, errors };
}

// ─── Notes Operations ───────────────────────────────────────────────────────────

function getNotes() {
  const notes = readJSON(NOTES_FILE, []);
  return notes.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}

function getNote(id) {
  const notes = readJSON(NOTES_FILE, []);
  return notes.find((n) => n.id === id) || null;
}

async function saveNote(note) {
  const notes = readJSON(NOTES_FILE, []);
  const now = new Date().toISOString();
  let savedNote = null;

  if (note.id) {
    const idx = notes.findIndex((n) => n.id === note.id);
    if (idx >= 0) {
      notes[idx] = { ...notes[idx], ...note, updatedAt: now };
      savedNote = notes[idx];
    } else {
      savedNote = {
        id: note.id,
        title: note.title || 'Untitled',
        content: note.content || '',
        createdAt: now,
        updatedAt: now,
        pinned: note.pinned || false,
        notionPageId: note.notionPageId || null,
      };
      notes.push(savedNote);
    }
  } else {
    savedNote = {
      id: generateId(),
      title: note.title || 'Untitled',
      content: note.content || '',
      createdAt: now,
      updatedAt: now,
      pinned: note.pinned || false,
      notionPageId: null,
    };
    notes.push(savedNote);
  }

  writeJSON(NOTES_FILE, notes);

  // Sync to Notion (non-blocking)
  pushToNotion(savedNote);

  return getNotes();
}

async function deleteNote(id) {
  const notes = readJSON(NOTES_FILE, []);
  const noteToDelete = notes.find((n) => n.id === id);

  if (noteToDelete && noteToDelete.notionPageId) {
    pushDeleteToNotion(noteToDelete);
  }

  const filtered = notes.filter((n) => n.id !== id);
  writeJSON(NOTES_FILE, filtered);
  return getNotes();
}

async function togglePin(id) {
  const notes = readJSON(NOTES_FILE, []);
  const idx = notes.findIndex((n) => n.id === id);
  if (idx >= 0) {
    notes[idx].pinned = !notes[idx].pinned;
    notes[idx].updatedAt = new Date().toISOString();
    writeJSON(NOTES_FILE, notes);
    pushToNotion(notes[idx]);
  }
  return getNotes();
}

// ─── Push to Notion (with offline fallback) ─────────────────────────────────────

async function pushToNotion(note) {
  setSyncStatus(true, null, 'Syncing to Notion...');

  try {
    const result = await notion.syncNote(note);

    if (result.success) {
      // Save notionPageId if newly created
      if (result.notionPageId && !note.notionPageId) {
        const notes = readJSON(NOTES_FILE, []);
        const idx = notes.findIndex((n) => n.id === note.id);
        if (idx >= 0) {
          notes[idx].notionPageId = result.notionPageId;
          writeJSON(NOTES_FILE, notes);
        }
      }
      setSyncStatus(false, null, 'Synced to Notion');
    } else {
      // Failed — add to offline queue
      console.log('[Sync] Push failed, queuing offline:', result.error);
      addToOfflineQueue('save', note);
      setSyncStatus(false, result.error, 'Queued for later');
    }
  } catch (err) {
    console.log('[Sync] Push error, queuing offline:', err.message);
    addToOfflineQueue('save', note);
    setSyncStatus(false, err.message, 'Queued for later');
  }
}

async function pushDeleteToNotion(note) {
  try {
    await notion.deleteNotionNote(note.notionPageId);
  } catch (err) {
    addToOfflineQueue('delete', note);
  }
}

// ─── Pull from Notion (2-way sync) ──────────────────────────────────────────────

async function pullFromNotion() {
  setSyncStatus(true, null, 'Pulling from Notion...');

  try {
    const result = await notion.pullAllNotes();

    if (!result.success) {
      setSyncStatus(false, result.error, 'Pull failed');
      return { success: false, error: result.error, added: 0, updated: 0 };
    }

    const remoteNotes = result.notes;
    const localNotes = readJSON(NOTES_FILE, []);
    let added = 0;
    let updated = 0;

    for (const remote of remoteNotes) {
      // Find matching local note by notionPageId
      const localIdx = localNotes.findIndex((n) => n.notionPageId === remote.notionPageId);

      if (localIdx >= 0) {
        // Note exists locally — compare timestamps, keep newer
        const localDate = new Date(localNotes[localIdx].updatedAt);
        const remoteDate = new Date(remote.updatedAt);

        if (remoteDate > localDate) {
          // Remote is newer — update local
          localNotes[localIdx].title = remote.title;
          localNotes[localIdx].content = remote.content;
          localNotes[localIdx].pinned = remote.pinned;
          localNotes[localIdx].updatedAt = remote.updatedAt;
          updated++;
        }
      } else {
        // Note doesn't exist locally — create it
        localNotes.push({
          id: generateId(),
          title: remote.title,
          content: remote.content,
          pinned: remote.pinned,
          createdAt: remote.createdAt,
          updatedAt: remote.updatedAt,
          notionPageId: remote.notionPageId,
        });
        added++;
      }
    }

    writeJSON(NOTES_FILE, localNotes);

    const msg = `Pulled: +${added} new, ~${updated} updated`;
    console.log(`[Sync] ${msg}`);
    setSyncStatus(false, null, msg);

    return { success: true, added, updated };
  } catch (err) {
    console.error('[Sync] Pull error:', err.message);
    setSyncStatus(false, err.message, 'Pull failed');
    return { success: false, error: err.message, added: 0, updated: 0 };
  }
}

// ─── Full Sync (pull + flush offline queue) ─────────────────────────────────────

async function fullSync() {
  setSyncStatus(true, null, 'Full sync...');

  // 1. Flush offline queue first (push local changes)
  const queueResult = await flushOfflineQueue();

  // 2. Pull from Notion (get remote changes)
  const pullResult = await pullFromNotion();

  if (pullResult.success) {
    const detail = `Synced! +${pullResult.added} new, ~${pullResult.updated} updated` +
      (queueResult.flushed > 0 ? `, ↑${queueResult.flushed} pushed` : '');
    setSyncStatus(false, null, detail);
  }

  return {
    success: pullResult.success,
    pull: pullResult,
    queue: queueResult,
  };
}

// ─── Test Notion Connection ─────────────────────────────────────────────────────

async function testNotionConnection() {
  return await notion.testConnection();
}

// ─── Settings ───────────────────────────────────────────────────────────────────

function getSettings() {
  return readJSON(SETTINGS_FILE, DEFAULT_SETTINGS);
}

function saveSettings(settings) {
  const current = getSettings();
  const merged = { ...current, ...settings };
  writeJSON(SETTINGS_FILE, merged);
  notion.setConfig(merged.notionApiKey || '', merged.notionDatabaseId || '');
  return merged;
}

module.exports = {
  getNotes,
  getNote,
  saveNote,
  deleteNote,
  togglePin,
  getSettings,
  saveSettings,
  getSyncStatus,
  testNotionConnection,
  pullFromNotion,
  fullSync,
  flushOfflineQueue,
};
