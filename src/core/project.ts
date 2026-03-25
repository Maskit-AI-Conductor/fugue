/**
 * Project management — .fugue/ directory operations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadYaml, saveYaml } from '../utils/yaml.js';

export const FUGUE_DIR = '.fugue';
export const CONFIG_FILE = 'config.yaml';
export const MODELS_FILE = 'models.yaml';

export const SUBDIRS = [
  'specs',
  'staging',
  'matrix',
  'tests',
  'agents',
  'logs',
  'reports',
  'plans',
  'changes',
  'tasks',
  'workflows',
];

export interface GenerationConfig {
  req_naming?: {
    pattern?: string;  // "REQ-{area}-{seq:03d}"
    areas?: Record<string, string>;  // { PUB: "Public", ADM: "Admin", ... }
  };
  limits?: {
    max_draft_per_confirmed?: number;  // default 5
    max_total_draft?: number;          // default 200
  };
  priority_rules?: {
    max_high_ratio?: number;  // default 0.30
  };
  test_generation?: {
    enabled?: boolean;          // default true
    min_tc_per_req?: number;    // default 1
    tc_naming?: string;         // "{req_id}-TC-{seq:02d}"
  };
  code_ref_validation?: {
    enabled?: boolean;
    must_exist?: boolean;
  };
}

export interface FugueConfig {
  version: number;
  project_name: string;
  conductor?: string;
  conductor_name?: string;
  scan: {
    include: string[];
    exclude: string[];
  };
  plan?: {
    source?: string;
    imported_at?: string;
    original_path?: string;
  };
  generation?: GenerationConfig;
  created: string;
  [key: string]: unknown;
}

export interface ModelsRegistry {
  version: number;
  models: ModelEntry[];
}

export interface ModelEntry {
  name: string;
  provider: string;
  model: string;
  endpoint?: string;
  api_key?: string;
  env_var?: string;
  subscription?: boolean;
  added_at: string;
}

export const DEFAULT_CONFIG: FugueConfig = {
  version: 2,
  project_name: '',
  scan: {
    include: [
      '**/*.py', '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.go', '**/*.rs', '**/*.java', '**/*.kt',
    ],
    exclude: [
      '**/node_modules/**', '**/.venv/**', '**/venv/**',
      '**/dist/**', '**/build/**', '**/__pycache__/**',
      '**/.fugue/**', '**/.git/**',
    ],
  },
  created: '',
};

const GITIGNORE_CONTENT = `# fugue credentials — never commit API keys
models.yaml
.credentials/
`;

/**
 * Walk up from start to find .fugue/ directory.
 */
export function findProjectRoot(start?: string): string | null {
  let current = start ?? process.cwd();
  const { root } = path.parse(current);

  while (true) {
    if (fs.existsSync(path.join(current, FUGUE_DIR))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current || parent === root) {
      // Check root too
      if (fs.existsSync(path.join(root, FUGUE_DIR))) {
        return root;
      }
      return null;
    }
    current = parent;
  }
}

/**
 * Get .fugue/ path if project exists.
 */
export function getFugueDir(start?: string): string | null {
  const root = findProjectRoot(start);
  return root ? path.join(root, FUGUE_DIR) : null;
}

/**
 * Require .fugue/ to exist, or throw.
 */
export function requireFugueDir(start?: string): string {
  const dir = getFugueDir(start);
  if (!dir) {
    throw new Error('Not a fugue project. Run `fugue init` first.');
  }
  return dir;
}

/**
 * Initialize .fugue/ directory with default structure.
 */
export function initProject(rootPath?: string, force = false): string {
  const root = rootPath ?? process.cwd();
  const fuguePath = path.join(root, FUGUE_DIR);

  if (fs.existsSync(fuguePath) && !force) {
    throw new Error(`.fugue/ already exists at ${root}`);
  }

  fs.mkdirSync(fuguePath, { recursive: true });
  for (const subdir of SUBDIRS) {
    fs.mkdirSync(path.join(fuguePath, subdir), { recursive: true });
  }

  const config: FugueConfig = {
    ...DEFAULT_CONFIG,
    project_name: path.basename(root),
    created: new Date().toISOString(),
  };
  saveConfig(fuguePath, config);

  // Initialize empty models registry
  const modelsRegistry: ModelsRegistry = {
    version: 1,
    models: [],
  };
  saveModels(fuguePath, modelsRegistry);

  // .gitignore for credential protection
  fs.writeFileSync(path.join(fuguePath, '.gitignore'), GITIGNORE_CONTENT, 'utf-8');

  return fuguePath;
}

// --- Config ---

export function loadConfig(fuguePath: string): FugueConfig {
  const configPath = path.join(fuguePath, CONFIG_FILE);
  return loadYaml<FugueConfig>(configPath) ?? { ...DEFAULT_CONFIG };
}

export function saveConfig(fuguePath: string, config: FugueConfig): void {
  saveYaml(path.join(fuguePath, CONFIG_FILE), config);
}

// --- Models ---

export function loadModels(fuguePath: string): ModelsRegistry {
  const modelsPath = path.join(fuguePath, MODELS_FILE);
  return loadYaml<ModelsRegistry>(modelsPath) ?? { version: 1, models: [] };
}

export function saveModels(fuguePath: string, registry: ModelsRegistry): void {
  // Strip api_key from saved models if env var is set
  const safeRegistry: ModelsRegistry = {
    ...registry,
    models: registry.models.map((m) => {
      const entry = { ...m };
      // Redact stored key (show hint only)
      if (entry.api_key && entry.api_key.length > 8) {
        entry.api_key = entry.api_key.slice(0, 4) + '...' + entry.api_key.slice(-4);
      }
      return entry;
    }),
  };
  saveYaml(path.join(fuguePath, MODELS_FILE), safeRegistry);
}

/**
 * Save models WITHOUT redacting keys (for internal use).
 */
export function saveModelsRaw(fuguePath: string, registry: ModelsRegistry): void {
  saveYaml(path.join(fuguePath, MODELS_FILE), registry);
}

// --- Specs ---

export interface ReqSpec {
  id: string;
  title: string;
  priority: string;
  description: string;
  status: string;
  created: string;
  confirmed_at?: string;
  code_refs?: string[];
  test_refs?: string[];
  source?: {
    file?: string;
    section?: string;
  };
  source_files?: string[];
  assigned_model?: string;
  [key: string]: unknown;
}

export function loadSpecs(fuguePath: string): ReqSpec[] {
  const specsDir = path.join(fuguePath, 'specs');
  if (!fs.existsSync(specsDir)) return [];

  const files = fs.readdirSync(specsDir)
    .filter((f) => f.startsWith('REQ-') && f.endsWith('.yaml'))
    .sort();

  const specs: ReqSpec[] = [];
  for (const file of files) {
    const spec = loadYaml<ReqSpec>(path.join(specsDir, file));
    if (spec) specs.push(spec);
  }
  return specs;
}

export function saveSpec(fuguePath: string, req: ReqSpec): void {
  const specsDir = path.join(fuguePath, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  saveYaml(path.join(specsDir, `${req.id}.yaml`), req);
}

// --- Matrix ---

export interface TraceMatrix {
  version: number;
  created: string;
  entries: Record<string, { code_refs: string[]; test_refs: string[] }>;
}

export function loadMatrix(fuguePath: string): TraceMatrix | null {
  return loadYaml<TraceMatrix>(path.join(fuguePath, 'matrix', 'matrix.yaml'));
}

export function saveMatrix(fuguePath: string, matrix: TraceMatrix): void {
  const matrixDir = path.join(fuguePath, 'matrix');
  fs.mkdirSync(matrixDir, { recursive: true });
  saveYaml(path.join(matrixDir, 'matrix.yaml'), matrix);
}

// --- Staging ---

export interface StagingMeta {
  timestamp: string;
  conductor: string;
  model_assignments: Array<{ agent: string; model: string }>;
  total_reqs: number;
}

export function getStagingDir(fuguePath: string): string {
  return path.join(fuguePath, 'staging');
}

export function hasStagingData(fuguePath: string): boolean {
  const stagingDir = getStagingDir(fuguePath);
  const metaFile = path.join(stagingDir, '_meta.yaml');
  return fs.existsSync(metaFile);
}

export function saveStagingSpec(fuguePath: string, req: ReqSpec): void {
  const stagingDir = getStagingDir(fuguePath);
  fs.mkdirSync(stagingDir, { recursive: true });
  saveYaml(path.join(stagingDir, `${req.id}.yaml`), req);
}

export function saveStagingMeta(fuguePath: string, meta: StagingMeta): void {
  const stagingDir = getStagingDir(fuguePath);
  fs.mkdirSync(stagingDir, { recursive: true });
  saveYaml(path.join(stagingDir, '_meta.yaml'), meta);
}

export function loadStagingSpecs(fuguePath: string): ReqSpec[] {
  const stagingDir = getStagingDir(fuguePath);
  if (!fs.existsSync(stagingDir)) return [];

  const files = fs.readdirSync(stagingDir)
    .filter((f) => f.startsWith('REQ-') && f.endsWith('.yaml'))
    .sort();

  const specs: ReqSpec[] = [];
  for (const file of files) {
    const spec = loadYaml<ReqSpec>(path.join(stagingDir, file));
    if (spec) specs.push(spec);
  }
  return specs;
}

export function loadStagingMeta(fuguePath: string): StagingMeta | null {
  const stagingDir = getStagingDir(fuguePath);
  return loadYaml<StagingMeta>(path.join(stagingDir, '_meta.yaml'));
}

export function clearStaging(fuguePath: string): void {
  const stagingDir = getStagingDir(fuguePath);
  if (fs.existsSync(stagingDir)) {
    const files = fs.readdirSync(stagingDir);
    for (const file of files) {
      fs.unlinkSync(path.join(stagingDir, file));
    }
  }
}

export function deleteSpec(fuguePath: string, reqId: string): void {
  const specFile = path.join(fuguePath, 'specs', `${reqId}.yaml`);
  if (fs.existsSync(specFile)) {
    fs.unlinkSync(specFile);
  }
}

export type DiffStatus = 'NEW' | 'CHANGED' | 'SAME' | 'REMOVED' | 'PROTECTED';

export interface DiffEntry {
  id: string;
  status: DiffStatus;
  title: string;
  stagingSpec?: ReqSpec;
  existingSpec?: ReqSpec;
  changes?: string[];  // list of changed fields
}

const PROTECTED_STATUSES = ['CONFIRMED', 'DEV', 'DONE'];

export function diffStagingVsSpecs(fuguePath: string): DiffEntry[] {
  const staging = loadStagingSpecs(fuguePath);
  const existing = loadSpecs(fuguePath);

  const existingMap = new Map(existing.map((s) => [s.id, s]));
  const stagingMap = new Map(staging.map((s) => [s.id, s]));

  const entries: DiffEntry[] = [];

  // Check staging items (NEW or CHANGED or SAME)
  for (const stg of staging) {
    const ext = existingMap.get(stg.id);
    if (!ext) {
      entries.push({ id: stg.id, status: 'NEW', title: stg.title, stagingSpec: stg });
    } else if (PROTECTED_STATUSES.includes(ext.status)) {
      entries.push({
        id: stg.id,
        status: 'PROTECTED',
        title: ext.title,
        stagingSpec: stg,
        existingSpec: ext,
      });
    } else {
      const changes: string[] = [];
      if (stg.title !== ext.title) changes.push('title');
      if (stg.description !== ext.description) changes.push('description');
      if (stg.priority !== ext.priority) changes.push('priority');
      if (changes.length > 0) {
        entries.push({
          id: stg.id,
          status: 'CHANGED',
          title: stg.title,
          stagingSpec: stg,
          existingSpec: ext,
          changes,
        });
      } else {
        entries.push({ id: stg.id, status: 'SAME', title: stg.title, stagingSpec: stg, existingSpec: ext });
      }
    }
  }

  // Check existing items not in staging (REMOVED or PROTECTED)
  for (const ext of existing) {
    if (!stagingMap.has(ext.id)) {
      if (PROTECTED_STATUSES.includes(ext.status)) {
        entries.push({
          id: ext.id,
          status: 'PROTECTED',
          title: ext.title,
          existingSpec: ext,
        });
      } else {
        entries.push({ id: ext.id, status: 'REMOVED', title: ext.title, existingSpec: ext });
      }
    }
  }

  // Sort by ID
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

// --- Tasks ---

export type TaskStatus = 'DRAFT' | 'OPEN' | 'DECOMPOSED' | 'CONFIRMED' | 'IN_PROGRESS' | 'DONE' | 'CLOSED';

export interface TaskEscalation {
  req_id: string;
  reason: string;
  created_at: string;
  resolved: boolean;
}

export interface TaskData {
  id: string;
  title: string;
  requester?: string;
  assignees: string[];
  status: TaskStatus;
  created_at: string;
  updated_at?: string;
  plan_file?: string;
  req_ids: string[];
  escalations: TaskEscalation[];
  validation?: {
    pass: boolean;
    issue_count: number;
    validated_at: string;
  };
}

/**
 * Get tasks directory path.
 */
export function getTasksDir(fuguePath: string): string {
  return path.join(fuguePath, 'tasks');
}

/**
 * Generate the next TASK-NNN ID.
 */
export function nextTaskId(fuguePath: string): string {
  const tasksDir = getTasksDir(fuguePath);
  if (!fs.existsSync(tasksDir)) return 'TASK-001';

  const files = fs.readdirSync(tasksDir)
    .filter((f) => f.startsWith('TASK-') && f.endsWith('.yaml'))
    .sort();

  if (files.length === 0) return 'TASK-001';

  const lastFile = files[files.length - 1];
  const lastNum = parseInt(lastFile.replace('TASK-', '').replace('.yaml', ''), 10);
  return `TASK-${String(lastNum + 1).padStart(3, '0')}`;
}

/**
 * Save a task to .fugue/tasks/TASK-NNN.yaml
 */
export function saveTask(fuguePath: string, task: TaskData): void {
  const tasksDir = getTasksDir(fuguePath);
  fs.mkdirSync(tasksDir, { recursive: true });
  saveYaml(path.join(tasksDir, `${task.id}.yaml`), task);
}

/**
 * Load a single task by ID.
 */
export function loadTask(fuguePath: string, taskId: string): TaskData | null {
  const filePath = path.join(getTasksDir(fuguePath), `${taskId}.yaml`);
  return loadYaml<TaskData>(filePath);
}

/**
 * Load all tasks.
 */
export function loadTasks(fuguePath: string): TaskData[] {
  const tasksDir = getTasksDir(fuguePath);
  if (!fs.existsSync(tasksDir)) return [];

  const files = fs.readdirSync(tasksDir)
    .filter((f) => f.startsWith('TASK-') && f.endsWith('.yaml'))
    .sort();

  const tasks: TaskData[] = [];
  for (const file of files) {
    const task = loadYaml<TaskData>(path.join(tasksDir, file));
    if (task) tasks.push(task);
  }
  return tasks;
}
