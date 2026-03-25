/**
 * Agent runner — execute agent tasks and collect logs.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { saveYaml } from '../utils/yaml.js';

export interface AgentLog {
  agent: string;
  action: string;
  model: string;
  started_at: string;
  completed_at: string;
  status: 'success' | 'failure' | 'partial';
  output_summary: string;
  tokens_in?: number;
  tokens_out?: number;
  details?: unknown;
}

export interface AgentDefinition {
  name: string;
  type: string;
  scope: string;
  assigned_model: string;
  created_at: string;
  boundaries?: string[];
  never?: string[];
}

/**
 * Save an agent definition to .bpro/agents/
 */
export function saveAgentDef(bproPath: string, def: AgentDefinition): void {
  const agentsDir = path.join(bproPath, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  saveYaml(path.join(agentsDir, `${def.name}.yaml`), def);
}

/**
 * Load all agent definitions.
 */
export function loadAgentDefs(bproPath: string): AgentDefinition[] {
  const agentsDir = path.join(bproPath, 'agents');
  if (!fs.existsSync(agentsDir)) return [];

  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.yaml')).sort();
  const defs: AgentDefinition[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
      const def = yaml.load(content) as AgentDefinition;
      if (def?.name) defs.push(def);
    } catch {
      // skip invalid files
    }
  }
  return defs;
}

/**
 * Append a log entry for an agent.
 */
export function appendAgentLog(bproPath: string, log: AgentLog): void {
  const logsDir = path.join(bproPath, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const logFile = path.join(logsDir, `${log.agent}.jsonl`);
  const line = JSON.stringify(log) + '\n';
  fs.appendFileSync(logFile, line, 'utf-8');
}

/**
 * Read logs for a specific agent.
 */
export function readAgentLogs(bproPath: string, agentName: string): AgentLog[] {
  const logFile = path.join(bproPath, 'logs', `${agentName}.jsonl`);
  if (!fs.existsSync(logFile)) return [];

  const content = fs.readFileSync(logFile, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  return lines.map((line) => JSON.parse(line) as AgentLog);
}

/**
 * List all agents that have logs.
 */
export function listLoggedAgents(bproPath: string): string[] {
  const logsDir = path.join(bproPath, 'logs');
  if (!fs.existsSync(logsDir)) return [];

  return fs.readdirSync(logsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace('.jsonl', ''))
    .sort();
}
