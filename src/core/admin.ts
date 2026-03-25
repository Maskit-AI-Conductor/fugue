/**
 * Admin — cross-project monitoring from ~/.fugue-admin/
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

const ADMIN_DIR = path.join(os.homedir(), '.fugue-admin');
const ADMIN_CONFIG = path.join(ADMIN_DIR, 'config.yaml');

export interface AdminProject {
  name: string;
  path: string;
  registered_at: string;
}

export interface AdminConfig {
  projects: AdminProject[];
}

export function ensureAdminDir(): void {
  fs.mkdirSync(ADMIN_DIR, { recursive: true });
}

export function loadAdminConfig(): AdminConfig {
  if (!fs.existsSync(ADMIN_CONFIG)) {
    return { projects: [] };
  }
  const raw = yaml.load(fs.readFileSync(ADMIN_CONFIG, 'utf-8')) as AdminConfig;
  return raw ?? { projects: [] };
}

export function saveAdminConfig(config: AdminConfig): void {
  ensureAdminDir();
  fs.writeFileSync(ADMIN_CONFIG, yaml.dump(config, { lineWidth: -1 }), 'utf-8');
}

export interface ProjectStats {
  name: string;
  path: string;
  initialized: boolean;
  reqs: number;
  done: number;
  agents: number;
  tasks: number;
  conductor?: string;
  lastActivity?: string;
  models: number;
}

export function getProjectStats(proj: AdminProject): ProjectStats {
  // Support both .fugue/ and legacy .bpro/
  let fugueDir = path.join(proj.path, '.fugue');
  if (!fs.existsSync(fugueDir)) {
    fugueDir = path.join(proj.path, '.bpro');
  }
  const base: ProjectStats = {
    name: proj.name,
    path: proj.path,
    initialized: false,
    reqs: 0, done: 0, agents: 0, tasks: 0, models: 0,
  };

  if (!fs.existsSync(fugueDir)) return base;
  base.initialized = true;

  // REQs
  const specsDir = path.join(fugueDir, 'specs');
  if (fs.existsSync(specsDir)) {
    const specFiles = fs.readdirSync(specsDir).filter(f => f.startsWith('REQ-') && f.endsWith('.yaml'));
    base.reqs = specFiles.length;
    for (const file of specFiles) {
      try {
        const content = fs.readFileSync(path.join(specsDir, file), 'utf-8');
        if (content.includes('status: DONE')) base.done++;
      } catch { /* skip */ }
    }
  }

  // Agents
  const agentsDir = path.join(fugueDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    base.agents = fs.readdirSync(agentsDir).filter(f => f.endsWith('.yaml')).length;
  }

  // Tasks
  const tasksDir = path.join(fugueDir, 'tasks');
  if (fs.existsSync(tasksDir)) {
    base.tasks = fs.readdirSync(tasksDir).filter(f => f.endsWith('.yaml')).length;
  }

  // Config
  const configFile = path.join(fugueDir, 'config.yaml');
  if (fs.existsSync(configFile)) {
    try {
      const config = yaml.load(fs.readFileSync(configFile, 'utf-8')) as Record<string, unknown>;
      base.conductor = config?.conductor as string | undefined;
    } catch { /* skip */ }
  }

  // Models
  const modelsFile = path.join(fugueDir, 'models.yaml');
  if (fs.existsSync(modelsFile)) {
    try {
      const models = yaml.load(fs.readFileSync(modelsFile, 'utf-8')) as { models?: unknown[] };
      base.models = models?.models?.length ?? 0;
    } catch { /* skip */ }
  }

  // Last activity
  const logsDir = path.join(fugueDir, 'logs');
  if (fs.existsSync(logsDir)) {
    let latest = '';
    for (const file of fs.readdirSync(logsDir).filter(f => f.endsWith('.jsonl'))) {
      try {
        const content = fs.readFileSync(path.join(logsDir, file), 'utf-8').trim();
        const lines = content.split('\n').filter(Boolean);
        if (lines.length > 0) {
          const last = JSON.parse(lines[lines.length - 1]) as { completed_at?: string };
          if (last.completed_at && last.completed_at > latest) latest = last.completed_at;
        }
      } catch { /* skip */ }
    }
    if (latest) base.lastActivity = latest.slice(0, 10);
  }

  return base;
}

export interface UsageEntry {
  model: string;
  provider: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
}

export interface CommandFreq {
  command: string;
  count: number;
}

export function getUsageStats(projects: AdminProject[], periodDays: number): {
  models: UsageEntry[];
  commands: CommandFreq[];
  totalCalls: number;
} {
  const cutoff = new Date(Date.now() - periodDays * 86400000).toISOString();
  const modelMap = new Map<string, UsageEntry>();
  const cmdMap = new Map<string, number>();
  let totalCalls = 0;

  for (const proj of projects) {
    let logsDir = path.join(proj.path, '.fugue', 'logs');
    if (!fs.existsSync(logsDir)) {
      logsDir = path.join(proj.path, '.bpro', 'logs');
    }
    if (!fs.existsSync(logsDir)) continue;

    for (const file of fs.readdirSync(logsDir).filter(f => f.endsWith('.jsonl'))) {
      try {
        const content = fs.readFileSync(path.join(logsDir, file), 'utf-8').trim();
        for (const line of content.split('\n').filter(Boolean)) {
          const log = JSON.parse(line) as {
            completed_at?: string;
            model?: string;
            action?: string;
            tokens_in?: number;
            tokens_out?: number;
          };
          if (!log.completed_at || log.completed_at < cutoff) continue;

          totalCalls++;
          const model = log.model ?? 'unknown';
          const existing = modelMap.get(model) ?? {
            model, provider: '', calls: 0, tokens_in: 0, tokens_out: 0,
          };
          existing.calls++;
          existing.tokens_in += log.tokens_in ?? 0;
          existing.tokens_out += log.tokens_out ?? 0;
          modelMap.set(model, existing);

          const cmd = log.action ?? 'unknown';
          cmdMap.set(cmd, (cmdMap.get(cmd) ?? 0) + 1);
        }
      } catch { /* skip */ }
    }
  }

  const models = [...modelMap.values()].sort((a, b) => b.calls - a.calls);
  const commands = [...cmdMap.entries()]
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count);

  return { models, commands, totalCalls };
}
