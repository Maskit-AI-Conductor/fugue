#!/usr/bin/env node

/**
 * Fugue MCP Server — stdio-based Model Context Protocol server.
 * Exposes fugue commands as tools for AI coding assistants.
 *
 * Does NOT call any LLM. All analysis is done by the host AI session.
 * This server only handles file I/O (read/write .fugue/ directory).
 */

import { handleRequest, getToolList } from './tools.js';

let buffer = '';

process.stdin.setEncoding('utf-8');

process.stdin.on('data', (chunk: string) => {
  buffer += chunk;

  // Try to parse complete JSON-RPC messages
  while (true) {
    // Look for Content-Length header
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = buffer.slice(0, headerEnd);
    const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!contentLengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(contentLengthMatch[1], 10);
    const bodyStart = headerEnd + 4;

    if (buffer.length < bodyStart + contentLength) break; // incomplete

    const body = buffer.slice(bodyStart, bodyStart + contentLength);
    buffer = buffer.slice(bodyStart + contentLength);

    try {
      const request = JSON.parse(body);
      handleJsonRpc(request);
    } catch {
      // ignore parse errors
    }
  }
});

async function handleJsonRpc(request: { id?: unknown; method: string; params?: Record<string, unknown> }) {
  const { id, method, params } = request;

  try {
    let result: unknown;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'fugue',
            version: '0.6.0',
          },
        };
        break;

      case 'notifications/initialized':
        // No response needed for notifications
        return;

      case 'tools/list':
        result = { tools: getToolList() };
        break;

      case 'tools/call':
        result = await handleRequest(
          (params as { name: string }).name,
          ((params as { arguments?: Record<string, unknown> }).arguments) ?? {},
        );
        break;

      default:
        sendResponse(id, null, { code: -32601, message: `Method not found: ${method}` });
        return;
    }

    sendResponse(id, result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendResponse(id, null, { code: -32603, message });
  }
}

function sendResponse(id: unknown, result: unknown, error?: { code: number; message: string }) {
  const response: Record<string, unknown> = { jsonrpc: '2.0', id };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }

  const body = JSON.stringify(response);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
}

// Log startup to stderr (not stdout, to keep protocol clean)
process.stderr.write('[fugue-mcp] Server started\n');
