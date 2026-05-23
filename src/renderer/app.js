/* ═══════════════════════════════════════════════════════════════════════════════
   QuickNote — Application Logic
   ═══════════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────

  let state = {
    notes: [],
    currentNoteId: null,
    searchQuery: '',
    theme: 'dark',
    sidebarCollapsed: false,
    alwaysOnTop: true,
  };

  let autoSaveTimer = null;
  const AUTO_SAVE_DELAY = 500; // ms

  // ─── DOM Elements ───────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const elements = {
    // Title bar
    btnSync: $('btnSync'),
    btnSettings: $('btnSettings'),
    btnToggleTheme: $('btnToggleTheme'),
    btnTogglePin: $('btnTogglePin'),
    btnMinimize: $('btnMinimize'),
    btnClose: $('btnClose'),

    // Sidebar
    sidebar: $('sidebar'),
    searchInput: $('searchInput'),
    btnNewNote: $('btnNewNote'),
    notesList: $('notesList'),
    notesCount: $('notesCount'),

    // Editor
    editorArea: $('editorArea'),
    editorToolbar: $('editorToolbar'),
    btnToggleSidebar: $('btnToggleSidebar'),
    noteTitleInput: $('noteTitleInput'),
    btnPinNote: $('btnPinNote'),
    btnDeleteNote: $('btnDeleteNote'),
    noteEditor: $('noteEditor'),
    saveStatus: $('saveStatus'),
    charCount: $('charCount'),

    // Empty state
    emptyState: $('emptyState'),

    // Settings Modal
    settingsModal: $('settingsModal'),
    btnCancelSettings: $('btnCancelSettings'),
    btnSaveSettings: $('btnSaveSettings'),
    inputNotionApiKey: $('inputNotionApiKey'),
    inputNotionDatabaseId: $('inputNotionDatabaseId'),
  };

  // Quill Editor Instance
  let quill;

  // ─── Initialize ─────────────────────────────────────────────────────────────

  async function init() {
    // Load settings
    const settings = await window.notesAPI.getSettings();
    state.theme = settings.theme || 'dark';
    state.alwaysOnTop = settings.alwaysOnTop !== false;
    applyTheme(state.theme);
    updatePinButton(state.alwaysOnTop);

    // Load notes
    state.notes = await window.notesAPI.getNotes();

    // Initialize Quill
    quill = new window.Quill('#noteEditor', {
      theme: 'snow',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline', 'strike'],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          [{ 'background': ['yellow', false] }],
          ['clean']
        ]
      },
      placeholder: 'Start typing your note...'
    });

    quill.on('text-change', onEditorInput);

    if (state.notes.length > 0) {
      state.currentNoteId = state.notes[0].id;
    }

    render();
    bindEvents();

    // Startup sync: pull from Notion (auto-restore if local is empty)
    startupSync();
  }

  async function startupSync() {
    try {
      const result = await window.notesAPI.testNotionConnection();
      if (result.success) {
        setSaveStatus('syncing', '☁ Syncing...');
        elements.btnSync.classList.add('spinning');

        // Wait a moment for main process auto-sync to complete
        await new Promise(r => setTimeout(r, 2000));

        // Reload notes (they may have been updated by auto-sync)
        state.notes = await window.notesAPI.getNotes();
        if (state.notes.length > 0 && !state.currentNoteId) {
          state.currentNoteId = state.notes[0].id;
        }
        render();

        elements.btnSync.classList.remove('spinning');
        setSaveStatus('synced', '☁ Synced with Notion');
        setTimeout(() => setSaveStatus('', 'Ready'), 3000);
      } else {
        setSaveStatus('sync-error', '⚠ Notion: ' + (result.error || 'offline'));
      }
    } catch (err) {
      elements.btnSync.classList.remove('spinning');
      setSaveStatus('sync-error', '⚠ Notion offline');
    }
  }

  // ─── Event Bindings ─────────────────────────────────────────────────────────

  function bindEvents() {
    // Title bar buttons
    elements.btnSync.addEventListener('click', manualSync);
    elements.btnSettings.addEventListener('click', openSettings);
    elements.btnToggleTheme.addEventListener('click', toggleTheme);
    elements.btnTogglePin.addEventListener('click', toggleAlwaysOnTop);
    elements.btnMinimize.addEventListener('click', () => window.notesAPI.minimizeWindow());
    elements.btnClose.addEventListener('click', () => window.notesAPI.hideWindow());

    // Sidebar
    elements.btnNewNote.addEventListener('click', createNewNote);
    elements.searchInput.addEventListener('input', onSearchInput);

    // Editor
    elements.btnToggleSidebar.addEventListener('click', toggleSidebar);
    elements.noteTitleInput.addEventListener('input', onTitleInput);
    elements.btnPinNote.addEventListener('click', pinCurrentNote);
    elements.btnDeleteNote.addEventListener('click', deleteCurrentNote);

    // Settings Modal
    elements.btnCancelSettings.addEventListener('click', closeSettings);
    elements.btnSaveSettings.addEventListener('click', saveSettings);
    elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === elements.settingsModal) closeSettings();
    });

    // Global
    document.addEventListener('keydown', onKeyDown);
  }

  // ─── Keyboard Shortcuts ─────────────────────────────────────────────────────

  function onKeyDown(e) {
    const isMod = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl + N = New note
    if (isMod && e.key === 'n') {
      e.preventDefault();
      createNewNote();
      return;
    }

    // Cmd/Ctrl + Shift + S = Manual sync
    if (isMod && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      manualSync();
      return;
    }

    // Cmd/Ctrl + F = Focus search
    if (isMod && e.key === 'f') {
      e.preventDefault();
      elements.searchInput.focus();
      return;
    }

    // Cmd/Ctrl + B = Toggle sidebar
    if (isMod && e.key === 'b') {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // Escape = Clear search / Hide window
    if (e.key === 'Escape') {
      if (elements.searchInput === document.activeElement && state.searchQuery) {
        elements.searchInput.value = '';
        state.searchQuery = '';
        renderNotesList();
      } else {
        window.notesAPI.hideWindow();
      }
      return;
    }
  }

  // ─── Manual Sync ──────────────────────────────────────────────────────────

  async function manualSync() {
    setSaveStatus('syncing', '☁ Syncing...');
    elements.btnSync.classList.add('spinning');

    try {
      const result = await window.notesAPI.fullSync();

      // Reload notes after sync
      state.notes = await window.notesAPI.getNotes();
      if (state.notes.length > 0 && !state.currentNoteId) {
        state.currentNoteId = state.notes[0].id;
      }
      render();

      if (result.success) {
        const detail = `☁ +${result.pull.added} new, ~${result.pull.updated} updated`;
        setSaveStatus('synced', detail);
      } else {
        setSaveStatus('sync-error', '⚠ Sync failed: ' + (result.pull.error || 'unknown'));
      }
    } catch (err) {
      setSaveStatus('sync-error', '⚠ Sync error');
    }

    elements.btnSync.classList.remove('spinning');
    setTimeout(() => setSaveStatus('', 'Ready'), 4000);
  }

  // ─── Settings Modal ───────────────────────────────────────────────────────

  async function openSettings() {
    const settings = await window.notesAPI.getSettings();
    elements.inputNotionApiKey.value = settings.notionApiKey || '';
    elements.inputNotionDatabaseId.value = settings.notionDatabaseId || '';
    elements.settingsModal.classList.add('show');
  }

  function closeSettings() {
    elements.settingsModal.classList.remove('show');
  }

  async function saveSettings() {
    const apiKey = elements.inputNotionApiKey.value.trim();
    const dbId = elements.inputNotionDatabaseId.value.trim();

    elements.btnSaveSettings.textContent = 'Saving...';
    elements.btnSaveSettings.disabled = true;

    // Save
    await window.notesAPI.saveSettings({
      notionApiKey: apiKey,
      notionDatabaseId: dbId
    });

    // Test connection
    setSaveStatus('syncing', '☁ Testing connection...');
    const result = await window.notesAPI.testNotionConnection();

    if (result.success) {
      setSaveStatus('synced', '☁ Connected to Notion!');
      closeSettings();
      setTimeout(() => manualSync(), 1000); // Trigger a sync
    } else {
      setSaveStatus('sync-error', '⚠ Notion error: ' + (result.error || 'Check credentials'));
      alert('Failed to connect to Notion. Please check your API Key and Database ID.\n\nError: ' + result.error);
    }

    elements.btnSaveSettings.textContent = 'Save';
    elements.btnSaveSettings.disabled = false;
  }

  // ─── Theme ──────────────────────────────────────────────────────────────────

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    state.theme = theme;
  }

  async function toggleTheme() {
    const newTheme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    await window.notesAPI.saveSettings({ theme: newTheme });

    // Add a little pulse animation
    elements.btnToggleTheme.style.transform = 'scale(0.8)';
    setTimeout(() => {
      elements.btnToggleTheme.style.transform = '';
    }, 150);
  }

  // ─── Always On Top ─────────────────────────────────────────────────────────

  async function toggleAlwaysOnTop() {
    const isOnTop = await window.notesAPI.toggleAlwaysOnTop();
    state.alwaysOnTop = isOnTop;
    updatePinButton(isOnTop);
  }

  function updatePinButton(isOnTop) {
    if (isOnTop) {
      elements.btnTogglePin.classList.add('active');
      elements.btnTogglePin.title = 'Always on top (enabled)';
    } else {
      elements.btnTogglePin.classList.remove('active');
      elements.btnTogglePin.title = 'Always on top (disabled)';
    }
  }

  // ─── Sidebar Toggle ────────────────────────────────────────────────────────

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    elements.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
    elements.btnToggleSidebar.classList.toggle('active', !state.sidebarCollapsed);
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  function onSearchInput(e) {
    state.searchQuery = e.target.value.toLowerCase().trim();
    renderNotesList();
  }

  // ─── Notes CRUD ─────────────────────────────────────────────────────────────

  async function createNewNote() {
    const notes = await window.notesAPI.saveNote({
      title: 'Untitled',
      content: '',
    });
    state.notes = notes;
    state.currentNoteId = notes[0].id; // newest note is first
    render();

    // Focus on title
    elements.noteTitleInput.focus();
    elements.noteTitleInput.select();
  }

  async function pinCurrentNote() {
    if (!state.currentNoteId) return;
    const notes = await window.notesAPI.togglePin(state.currentNoteId);
    state.notes = notes;
    render();
  }

  function deleteCurrentNote() {
    if (!state.currentNoteId) return;

    const note = getCurrentNote();
    if (!note) return;

    // Show delete confirmation
    showDeleteConfirm(note);
  }

  async function confirmDelete(noteId) {
    const notes = await window.notesAPI.deleteNote(noteId);
    state.notes = notes;

    if (notes.length > 0) {
      state.currentNoteId = notes[0].id;
    } else {
      state.currentNoteId = null;
    }

    render();
  }

  function showDeleteConfirm(note) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';
    overlay.innerHTML = `
      <div class="delete-confirm-dialog">
        <h3>Delete Note?</h3>
        <p>"${escapeHtml(note.title)}" will be permanently deleted.</p>
        <div class="delete-confirm-actions">
          <button class="btn-cancel" id="btnCancelDelete">Cancel</button>
          <button class="btn-confirm-delete" id="btnConfirmDelete">Delete</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#btnCancelDelete').addEventListener('click', () => {
      overlay.remove();
    });

    overlay.querySelector('#btnConfirmDelete').addEventListener('click', () => {
      overlay.remove();
      confirmDelete(note.id);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ─── Auto-Save ──────────────────────────────────────────────────────────────

  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);

    setSaveStatus('saving', '● Saving...');

    autoSaveTimer = setTimeout(async () => {
      const note = getCurrentNote();
      if (!note) return;

      await window.notesAPI.saveNote({
        id: note.id,
        title: elements.noteTitleInput.value || 'Untitled',
        content: quill.root.innerHTML,
      });

      // Refresh notes list
      state.notes = await window.notesAPI.getNotes();
      renderNotesList();
      setSaveStatus('saved', '✓ Saved');

      // Check Notion sync status after a short delay
      setTimeout(async () => {
        try {
          const syncStatus = await window.notesAPI.getSyncStatus();
          if (syncStatus.syncing) {
            setSaveStatus('syncing', '☁ Syncing to Notion...');
          } else if (syncStatus.error) {
            setSaveStatus('sync-error', '⚠ Notion: ' + syncStatus.error);
            setTimeout(() => setSaveStatus('', 'Ready'), 4000);
          } else if (syncStatus.lastSyncAt) {
            setSaveStatus('synced', '☁ Synced to Notion');
            setTimeout(() => setSaveStatus('', 'Ready'), 3000);
          } else {
            setTimeout(() => setSaveStatus('', 'Ready'), 2000);
          }
        } catch (e) {
          setTimeout(() => setSaveStatus('', 'Ready'), 2000);
        }
      }, 800);
    }, AUTO_SAVE_DELAY);
  }

  function setSaveStatus(className, text) {
    elements.saveStatus.className = 'save-status ' + className;
    elements.saveStatus.textContent = text;
  }

  // ─── Input Handlers ─────────────────────────────────────────────────────────

  function onTitleInput() {
    scheduleAutoSave();
  }

  function onEditorInput() {
    updateCharCount();
    scheduleAutoSave();
  }

  function updateCharCount() {
    const text = quill.getText();
    const count = text.trim().length;
    elements.charCount.textContent = `${count} character${count !== 1 ? 's' : ''}`;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function stripHtml(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  function render() {
    renderNotesList();
    renderEditor();
  }

  function renderNotesList() {
    let notes = state.notes;

    // Filter by search
    if (state.searchQuery) {
      notes = notes.filter((n) => {
        const plainText = stripHtml(n.content).toLowerCase();
        return (
          n.title.toLowerCase().includes(state.searchQuery) ||
          plainText.includes(state.searchQuery)
        );
      });
    }

    // Render list
    elements.notesList.innerHTML = notes
      .map((note) => {
        const plainText = stripHtml(note.content);
        return `
        <div class="note-item ${note.id === state.currentNoteId ? 'active' : ''} ${note.pinned ? 'pinned' : ''}"
             data-id="${note.id}">
          <div class="note-item-title">${escapeHtml(note.title)}</div>
          <div class="note-item-preview">${escapeHtml(plainText.substring(0, 80))}</div>
          <div class="note-item-date">${formatDate(note.updatedAt)}</div>
        </div>
      `;
      })
      .join('');

    // Bind click events
    elements.notesList.querySelectorAll('.note-item').forEach((el) => {
      el.addEventListener('click', () => {
        state.currentNoteId = el.dataset.id;
        render();
      });
    });

    // Update count
    elements.notesCount.textContent = `${state.notes.length} note${state.notes.length !== 1 ? 's' : ''}`;
  }

  function renderEditor() {
    const note = getCurrentNote();

    if (!note) {
      // Show empty state
      elements.editorArea.style.display = 'none';
      elements.emptyState.style.display = 'flex';
      return;
    }

    elements.editorArea.style.display = 'flex';
    elements.emptyState.style.display = 'none';

    elements.noteTitleInput.value = note.title;
    
    // Disable text-change event while loading content programmatically
    quill.off('text-change', onEditorInput);
    quill.clipboard.dangerouslyPasteHTML(note.content || '');
    quill.on('text-change', onEditorInput);
    
    updateCharCount();

    // Update pin button state
    elements.btnPinNote.classList.toggle('active', note.pinned);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function getCurrentNote() {
    return state.notes.find((n) => n.id === state.currentNoteId) || null;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  // ─── Start App ─────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', init);
})();
