/**
 * Notion integration — fetch page content as markdown.
 * Two modes:
 * 1. Public page: scrape HTML, no API key needed
 * 2. Private page: Notion API, requires NOTION_API_KEY
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

interface NotionBlock {
  type: string;
  [key: string]: unknown;
}

/**
 * Extract page ID from various Notion URL formats:
 * - https://www.notion.so/workspace/Page-Title-abc123def456
 * - https://www.notion.so/abc123def456
 * - https://notion.so/workspace/abc123def456?v=xxx
 * - Just the ID: abc123def456
 */
export function extractPageId(urlOrId: string): string {
  // Already a clean ID (32 hex chars)
  if (/^[a-f0-9]{32}$/i.test(urlOrId)) {
    return urlOrId;
  }

  // URL format
  try {
    const url = new URL(urlOrId);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1] ?? '';
    // Page ID is the last 32 hex chars (may have dashes)
    const match = lastPart.match(/([a-f0-9]{32})$/i) ?? lastPart.match(/([a-f0-9-]{36})$/i);
    if (match) {
      return match[1].replace(/-/g, '');
    }
    // Try extracting from the full last segment (Title-abc123...)
    const hexMatch = lastPart.match(/([a-f0-9]{32})/i);
    if (hexMatch) return hexMatch[1];
  } catch {
    // Not a URL, try as raw ID with dashes
    const cleaned = urlOrId.replace(/-/g, '');
    if (/^[a-f0-9]{32}$/i.test(cleaned)) return cleaned;
  }

  throw new Error(`Cannot extract Notion page ID from: ${urlOrId}`);
}

/**
 * Get API key from env or .fugue/config
 */
function getApiKey(): string {
  const key = process.env.NOTION_API_KEY ?? process.env.NOTION_TOKEN;
  if (!key) {
    throw new Error(
      'Notion API key not found. Set NOTION_API_KEY environment variable.\n' +
      '  1. Go to https://www.notion.so/my-integrations\n' +
      '  2. Create integration → copy token\n' +
      '  3. export NOTION_API_KEY=ntn_xxx\n' +
      '  4. Share the Notion page with your integration'
    );
  }
  return key;
}

/**
 * Fetch page title
 */
async function fetchPageTitle(pageId: string, apiKey: string): Promise<string> {
  const resp = await fetch(`${NOTION_API}/pages/${pageId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 404) {
      throw new Error('Page not found. Make sure you shared it with your Notion integration.');
    }
    throw new Error(`Notion API error ${resp.status}: ${text}`);
  }

  const data = await resp.json() as {
    properties?: {
      title?: { title?: Array<{ plain_text?: string }> };
      Name?: { title?: Array<{ plain_text?: string }> };
    };
  };

  // Try common title property names
  const titleProp = data.properties?.title ?? data.properties?.Name;
  const titleParts = titleProp?.title ?? [];
  return titleParts.map(t => t.plain_text ?? '').join('') || 'Untitled';
}

/**
 * Fetch all blocks (children) of a page, handling pagination
 */
async function fetchBlocks(blockId: string, apiKey: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const url = `${NOTION_API}/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Notion API error ${resp.status}: ${text}`);
    }

    const data = await resp.json() as {
      results: NotionBlock[];
      has_more: boolean;
      next_cursor?: string;
    };

    blocks.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

/**
 * Convert rich text array to plain text
 */
function richTextToPlain(richText: Array<{ plain_text?: string }> | undefined): string {
  if (!richText) return '';
  return richText.map(t => t.plain_text ?? '').join('');
}

/**
 * Convert rich text to markdown (basic formatting)
 */
function richTextToMd(richText: Array<{ plain_text?: string; annotations?: { bold?: boolean; italic?: boolean; code?: boolean; strikethrough?: boolean } }> | undefined): string {
  if (!richText) return '';
  return richText.map(t => {
    let text = t.plain_text ?? '';
    if (t.annotations?.code) text = `\`${text}\``;
    if (t.annotations?.bold) text = `**${text}**`;
    if (t.annotations?.italic) text = `*${text}*`;
    if (t.annotations?.strikethrough) text = `~~${text}~~`;
    return text;
  }).join('');
}

/**
 * Convert a single Notion block to markdown
 */
function blockToMd(block: NotionBlock): string {
  const b = block as Record<string, unknown>;
  const type = b.type as string;
  const content = b[type] as Record<string, unknown> | undefined;

  if (!content) return '';

  const rt = content.rich_text as Array<{ plain_text?: string; annotations?: Record<string, boolean> }> | undefined;
  const text = richTextToMd(rt);

  switch (type) {
    case 'paragraph': return text || '';
    case 'heading_1': return `# ${text}`;
    case 'heading_2': return `## ${text}`;
    case 'heading_3': return `### ${text}`;
    case 'bulleted_list_item': return `- ${text}`;
    case 'numbered_list_item': return `1. ${text}`;
    case 'to_do': {
      const checked = (content.checked as boolean) ? 'x' : ' ';
      return `- [${checked}] ${text}`;
    }
    case 'toggle': return `<details><summary>${text}</summary></details>`;
    case 'quote': return `> ${text}`;
    case 'callout': return `> ${text}`;
    case 'code': {
      const lang = (content.language as string) ?? '';
      return `\`\`\`${lang}\n${richTextToPlain(rt as Array<{ plain_text?: string }>)}\n\`\`\``;
    }
    case 'divider': return '---';
    case 'table_row': {
      const cells = content.cells as Array<Array<{ plain_text?: string }>> | undefined;
      if (!cells) return '';
      return '| ' + cells.map(c => richTextToPlain(c)).join(' | ') + ' |';
    }
    case 'image': {
      const imgContent = content as { type?: string; file?: { url?: string }; external?: { url?: string } };
      const url = imgContent.file?.url ?? imgContent.external?.url ?? '';
      return url ? `![image](${url})` : '';
    }
    case 'bookmark': {
      const bmUrl = (content as { url?: string }).url ?? '';
      return bmUrl ? `[${bmUrl}](${bmUrl})` : '';
    }
    default: return text || '';
  }
}

/**
 * Fetch a public Notion page by scraping HTML (no API key needed).
 * Works with any "Share to web" enabled page.
 */
async function fetchPublicPage(url: string): Promise<{ title: string; markdown: string }> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; fugue-cli/0.5)',
      'Accept': 'text/html',
    },
    redirect: 'follow',
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch page (${resp.status}). Is it published to web?`);
  }

  const html = await resp.text();

  // Extract title from <title> or <meta>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/ \| Notion$/, '').trim() ?? 'Untitled';

  // Extract text content from the page
  // Notion public pages render content in article/main tags
  const lines: string[] = [`# ${title}`, ''];

  // Extract headings
  const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    const level = match[1];
    const text = stripHtml(match[2]);
    if (text) lines.push(`${'#'.repeat(Number(level))} ${text}`);
  }

  // Extract paragraphs and list items
  const blockRegex = /<(?:p|li|div)[^>]*class="[^"]*notion-[^"]*"[^>]*>([\s\S]*?)<\/(?:p|li|div)>/gi;
  while ((match = blockRegex.exec(html)) !== null) {
    const text = stripHtml(match[1]);
    if (text && text.length > 1) lines.push(text);
  }

  // If we got very little from structured extraction, fallback to all visible text
  if (lines.length < 5) {
    // Strip scripts, styles, and HTML tags
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const body = bodyMatch?.[1] ?? html;
    const cleaned = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '');

    const textBlocks = cleaned
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    // Deduplicate and use
    const seen = new Set<string>();
    for (const block of textBlocks) {
      if (!seen.has(block) && block.length > 2) {
        seen.add(block);
        lines.push(block);
      }
    }
  }

  return { title, markdown: lines.join('\n') };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Fetch a Notion page and convert to Markdown.
 * - If NOTION_API_KEY is set: uses Notion API (private pages OK)
 * - If no API key: scrapes public page HTML (published to web only)
 */
export async function notionPageToMarkdown(urlOrId: string): Promise<{ title: string; markdown: string }> {
  // Try API first if key exists
  const apiKey = process.env.NOTION_API_KEY ?? process.env.NOTION_TOKEN;

  if (apiKey) {
    const pageId = extractPageId(urlOrId);
    const title = await fetchPageTitle(pageId, apiKey);
    const blocks = await fetchBlocks(pageId, apiKey);

    const lines: string[] = [`# ${title}`, ''];
    for (const block of blocks) {
      const md = blockToMd(block);
      lines.push(md);

      if ((block as Record<string, unknown>).has_children) {
        const children = await fetchBlocks((block as Record<string, unknown>).id as string, apiKey);
        for (const child of children) {
          const childMd = blockToMd(child);
          if (childMd) lines.push(`  ${childMd}`);
        }
      }
    }

    return { title, markdown: lines.join('\n') };
  }

  // No API key — scrape public page
  if (!urlOrId.startsWith('http')) {
    throw new Error(
      'No NOTION_API_KEY set. For public pages, provide the full URL.\n' +
      'For private pages, set NOTION_API_KEY environment variable.'
    );
  }

  return fetchPublicPage(urlOrId);
}
