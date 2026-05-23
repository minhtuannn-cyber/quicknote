/* ═══════════════════════════════════════════════════════════════════════════════
   QuickNote — Notion Sync Module
   Two-way sync: QuickNote ↔ Notion Database
   ═══════════════════════════════════════════════════════════════════════════════ */

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ─── Configuration ──────────────────────────────────────────────────────────────

let config = {
  apiKey: '',
  databaseId: '',
};

function setConfig(apiKey, databaseId) {
  config.apiKey = apiKey;
  config.databaseId = databaseId;
}

// ─── API Helper ─────────────────────────────────────────────────────────────────

async function notionFetch(endpoint, method = 'GET', body = null) {
  if (!config.apiKey) {
    return { success: false, error: 'Notion API key not configured', data: null };
  }

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${NOTION_API_BASE}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
      console.error('[Notion] API Error:', data.message || data);
      return { success: false, error: data.message || 'Unknown error', data: null };
    }

    return { success: true, error: null, data };
  } catch (err) {
    console.error('[Notion] Network Error:', err.message);
    return { success: false, error: err.message, data: null };
  }
}

// ─── Split text into 2000-char chunks for Notion rich_text ──────────────────────

function splitTextToChunks(text, maxLength = 2000) {
  if (!text) return [{ type: 'text', text: { content: '' } }];

  const chunks = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push({
      type: 'text',
      text: { content: text.slice(i, i + maxLength) },
    });
  }
  return chunks.length > 0 ? chunks : [{ type: 'text', text: { content: '' } }];
}

// ─── Create a note in Notion ────────────────────────────────────────────────────

async function createNotionPage(note) {
  const body = {
    parent: { database_id: config.databaseId },
    properties: {
      Title: {
        title: [{ type: 'text', text: { content: note.title || 'Untitled' } }],
      },
    },
    children: buildContentBlocks(note.content),
  };

  // Add Pinned property only if it exists in the database
  if (note.pinned !== undefined) {
    body.properties.Pinned = { checkbox: note.pinned || false };
  }

  const result = await notionFetch('/pages', 'POST', body);

  if (result.success) {
    console.log(`[Notion] Created page: ${result.data.id}`);
    return { success: true, notionPageId: result.data.id };
  }

  return { success: false, error: result.error };
}

// ─── Update a note in Notion ────────────────────────────────────────────────────

async function updateNotionPage(notionPageId, note) {
  const propsBody = {
    properties: {
      Title: {
        title: [{ type: 'text', text: { content: note.title || 'Untitled' } }],
      },
    },
  };

  if (note.pinned !== undefined) {
    propsBody.properties.Pinned = { checkbox: note.pinned || false };
  }

  const propsResult = await notionFetch(`/pages/${notionPageId}`, 'PATCH', propsBody);

  if (!propsResult.success) {
    return { success: false, error: propsResult.error };
  }

  // Replace page content
  await replacePageContent(notionPageId, note.content);

  console.log(`[Notion] Updated page: ${notionPageId}`);
  return { success: true };
}

// ─── Replace page content ───────────────────────────────────────────────────────

async function replacePageContent(pageId, content) {
  // 1. Get existing children blocks
  const childrenResult = await notionFetch(`/blocks/${pageId}/children?page_size=100`, 'GET');

  if (childrenResult.success && childrenResult.data.results) {
    // 2. Delete each existing block
    for (const block of childrenResult.data.results) {
      await notionFetch(`/blocks/${block.id}`, 'DELETE');
    }
  }

  // 3. Add new content blocks
  if (content && content.trim()) {
    const blocks = buildContentBlocks(content);
    if (blocks.length > 0) {
      await notionFetch(`/blocks/${pageId}/children`, 'PATCH', {
        children: blocks,
      });
    }
  }
}

// ─── Build Notion blocks from plain text content ────────────────────────────────

function buildContentBlocks(content) {
  if (!content || !content.trim()) return [];

  const lines = content.split('\n');
  const blocks = [];

  for (const line of lines) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: splitTextToChunks(line),
      },
    });
  }

  // Notion API limits to 100 blocks per request
  return blocks.slice(0, 100);
}

// ─── Archive (soft delete) a note in Notion ─────────────────────────────────────

async function archiveNotionPage(notionPageId) {
  const result = await notionFetch(`/pages/${notionPageId}`, 'PATCH', {
    archived: true,
  });

  if (result.success) {
    console.log(`[Notion] Archived page: ${notionPageId}`);
  }

  return result;
}

// ─── Pull ALL notes from Notion database ────────────────────────────────────────

async function pullAllNotes() {
  if (!config.apiKey || !config.databaseId) {
    return { success: false, error: 'Notion not configured', notes: [] };
  }

  console.log('[Notion] Pulling all notes from database...');

  const result = await notionFetch(`/databases/${config.databaseId}/query`, 'POST', {
    filter: {
      property: 'Title',
      title: { is_not_empty: true },
    },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: 100,
  });

  if (!result.success) {
    // Try without filter (in case database has different structure)
    const retryResult = await notionFetch(`/databases/${config.databaseId}/query`, 'POST', {
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 100,
    });

    if (!retryResult.success) {
      return { success: false, error: retryResult.error, notes: [] };
    }

    result.data = retryResult.data;
    result.success = true;
  }

  const pages = result.data.results || [];
  const notes = [];

  for (const page of pages) {
    if (page.archived) continue; // Skip archived pages

    try {
      const note = await parseNotionPage(page);
      if (note) notes.push(note);
    } catch (err) {
      console.error(`[Notion] Error parsing page ${page.id}:`, err.message);
    }
  }

  console.log(`[Notion] Pulled ${notes.length} notes from Notion`);
  return { success: true, notes };
}

// ─── Parse a Notion page into a local note format ───────────────────────────────

async function parseNotionPage(page) {
  // Extract title
  let title = 'Untitled';
  const titleProp = page.properties.Title || page.properties.Name || page.properties.title;
  if (titleProp && titleProp.title && titleProp.title.length > 0) {
    title = titleProp.title.map((t) => t.plain_text).join('');
  }

  // Extract pinned (if property exists)
  let pinned = false;
  if (page.properties.Pinned && page.properties.Pinned.checkbox !== undefined) {
    pinned = page.properties.Pinned.checkbox;
  }

  // Get page content (children blocks)
  const content = await getPageContent(page.id);

  return {
    notionPageId: page.id,
    title,
    content,
    pinned,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
  };
}

// ─── Get page content as plain text ─────────────────────────────────────────────

async function getPageContent(pageId) {
  const result = await notionFetch(`/blocks/${pageId}/children?page_size=100`, 'GET');

  if (!result.success || !result.data.results) {
    return '';
  }

  const lines = [];
  for (const block of result.data.results) {
    const text = extractBlockText(block);
    lines.push(text);
  }

  return lines.join('\n');
}

// ─── Extract plain text from a Notion block ─────────────────────────────────────

function extractBlockText(block) {
  const type = block.type;
  const data = block[type];

  if (!data || !data.rich_text) return '';

  return data.rich_text.map((t) => t.plain_text || '').join('');
}

// ─── Sync a single note (push to Notion) ───────────────────────────────────────

async function syncNote(note) {
  if (!config.apiKey || !config.databaseId) {
    return { success: false, error: 'Notion not configured' };
  }

  try {
    if (note.notionPageId) {
      return await updateNotionPage(note.notionPageId, note);
    } else {
      return await createNotionPage(note);
    }
  } catch (err) {
    console.error('[Notion] Sync error:', err);
    return { success: false, error: err.message };
  }
}

// ─── Delete (archive) a note from Notion ────────────────────────────────────────

async function deleteNotionNote(notionPageId) {
  if (!notionPageId || !config.apiKey) return { success: false };
  return await archiveNotionPage(notionPageId);
}

// ─── Test connection ────────────────────────────────────────────────────────────

async function testConnection() {
  if (!config.apiKey || !config.databaseId) {
    return { success: false, error: 'Notion not configured' };
  }

  const result = await notionFetch(`/databases/${config.databaseId}`, 'GET');

  if (result.success) {
    console.log(`[Notion] Connected to database: ${result.data.title?.[0]?.plain_text || 'Unknown'}`);
    return { success: true, databaseName: result.data.title?.[0]?.plain_text };
  }

  return { success: false, error: result.error };
}

// ─── Check if online ────────────────────────────────────────────────────────────

async function isOnline() {
  if (!config.apiKey || !config.databaseId) return false;

  try {
    const result = await notionFetch(`/databases/${config.databaseId}`, 'GET');
    return result.success;
  } catch {
    return false;
  }
}

module.exports = {
  setConfig,
  syncNote,
  deleteNotionNote,
  pullAllNotes,
  testConnection,
  isOnline,
};
