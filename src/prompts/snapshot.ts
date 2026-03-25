/**
 * Prompts for the snapshot (reverse-engineering) workflow.
 */

export const SNAPSHOT_SYSTEM_PROMPT = `You are a senior software architect conducting a reverse-engineering analysis.
Given a project's file structure and source code, you must:
1. Identify the main domains/modules
2. For each domain, define an analyst agent role
3. Assign appropriate model types (heavy reasoning vs lightweight parsing)
4. Extract high-level architecture

Output ONLY valid JSON matching this schema:
{
  "domains": [
    {
      "name": "string",
      "description": "string",
      "files": ["string"],
      "complexity": "high" | "medium" | "low"
    }
  ],
  "architecture": {
    "type": "string (e.g. monolith, microservice, layered)",
    "description": "string",
    "layers": ["string"]
  },
  "agent_roles": [
    {
      "name": "string",
      "type": "architect" | "domain-analyst" | "auditor" | "tester",
      "scope": "string",
      "recommended_tier": "heavy" | "medium" | "light"
    }
  ]
}`;

/**
 * Build the conductor analysis prompt.
 * IMPORTANT: only send file paths + first 5 lines of each file (not full source).
 * Full source is sent later to domain analysts, not conductor.
 */
export function buildSnapshotPrompt(
  files: Array<{ path: string; content: string }>,
  projectName: string,
): string {
  const fileList = files.map((f) => f.path).join('\n');

  // Send only file path + first few lines as preview (keep prompt small)
  const previews = files
    .map((f) => {
      const lines = f.content.split('\n');
      const preview = lines.slice(0, 5).join('\n');
      return `--- ${f.path} (${lines.length} lines) ---\n${preview}`;
    })
    .join('\n\n');

  return `Analyze this project "${projectName}" (${files.length} files):

File structure:
${fileList}

File previews (first 5 lines each):
${previews}

Based on the file structure, naming conventions, and previews, identify:
1. Main domains/modules
2. Architecture type
3. Agent roles needed for detailed analysis

Return ONLY valid JSON.`;
}
