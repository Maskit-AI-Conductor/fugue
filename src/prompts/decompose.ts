/**
 * Prompts for plan decomposition workflow.
 */

import type { FugueConfig } from '../core/project.js';

export const DECOMPOSE_SYSTEM_PROMPT = `You are a requirements analyst. Extract functional requirements from a planning document.
Output ONLY a valid JSON array. No other text before or after.
Each requirement object has these fields:
- "id": sequential like "REQ-001", "REQ-002"
- "title": short name (under 60 chars)
- "priority": one of "HIGH", "MEDIUM", "LOW"
- "description": one sentence describing the testable behavior
- "source_section": which section of the document this came from

Additional rules:
- Keep each requirement ATOMIC: one testable behavior per REQ
- Description must be 50-150 chars with a verifiable condition
- Do NOT generate infrastructure/deployment requirements
- Do NOT generate duplicate requirements
- Priority distribution: aim for ~25% HIGH, ~50% MEDIUM, ~25% LOW
- If the input has severity/priority hints, inherit them
If the document is in Korean, keep title and description in Korean.
IMPORTANT: Output in Korean ONLY. Do NOT use Japanese, Chinese characters, or any non-Korean text in title or description.`;

/**
 * Build a system prompt enhanced with config-driven rules.
 * Falls back to the base DECOMPOSE_SYSTEM_PROMPT when no generation config exists.
 */
export function buildDecomposeSystemPrompt(config?: FugueConfig): string {
  let prompt = DECOMPOSE_SYSTEM_PROMPT;

  const gen = config?.generation;

  // Max total draft limit
  const maxTotal = gen?.limits?.max_total_draft ?? 200;
  prompt += `\n- Maximum ${maxTotal} requirements from this document`;

  // Area-prefixed naming
  if (gen?.req_naming?.areas) {
    const areas = gen.req_naming.areas;
    const areaList = Object.entries(areas)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    prompt += `\n- Use domain-prefixed IDs: REQ-PUB-001, REQ-ADM-001, etc.`;
    prompt += `\n- Area mapping: ${areaList}`;
  }

  return prompt;
}

export function buildDecomposePrompt(docContent: string): string {
  return `Extract requirements from this planning document:

---
${docContent}
---

Return a JSON array:
[{"id": "REQ-001", "title": "...", "priority": "HIGH", "description": "...", "source_section": "..."}]`;
}
