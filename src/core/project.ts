/**
 * Project management — .bpro/ directory operations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadYaml, saveYaml } from '../utils/yaml.js';

export const BPRO_DIR = '.bpro';
export const CONFIG_FILE = 'config.yaml';
export const MODELS_FILE = 'models.yaml';

export const SUBDIRS = [
  'specs',
  'matrix',
  'tests',
  'agents',
  'logs',
  'reports',
  'plans',
  'changes',
];

export interface BproConfig {
  version: number;
  project_name: string;
  conductor?: string;
  scan: {
    include: string[];
    exclude: string[];
  };
  plan?: {
    source?: string;
    imported_at?: string;
    original_path?: string;
  };
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

export const DEFAULT_CONFIG: BproConfig = {
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
      '**/.bpro/**', '**/.git/**',
    ],
  },
  created: '',
};

const GITIGNORE_CONTENT = `# bpro credentials — never commit API keys
models.yaml
.credentials/
`;

/**
 * Walk up from start to find .bpro/ directory.
 */
export function findProjectRoot(start?: string): string | null {
  let current = start ?? process.cwd();
  const { root } = path.parse(current);

  while (true) {
    if (fs.existsSync(path.join(current, BPRO_DIR))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current || parent === root) {
      // Check root too
      if (fs.existsSync(path.join(root, BPRO_DIR))) {
        return root;
      }
      return null;
    }
    current = parent;
  }
}

/**
 * Get .bpro/ path if project exists.
 */
export function getBproDir(start?: string): string | null {
  const root = findProjectRoot(start);
  return root ? path.join(root, BPRO_DIR) : null;
}

/**
 * Require .bpro/ to exist, or throw.
 */
export function requireBproDir(start?: string): string {
  const dir = getBproDir(start);
  if (!dir) {
    throw new Error('Not a bpro project. Run `bpro init` first.');
  }
  return dir;
}

/**
 * Initialize .bpro/ directory with default structure.
 */
export function initProject(rootPath?: string, force = false): string {
  const root = rootPath ?? process.cwd();
  const bproPath = path.join(root, BPRO_DIR);

  if (fs.existsSync(bproPath) && !force) {
    throw new Error(`.bpro/ already exists at ${root}`);
  }

  fs.mkdirSync(bproPath, { recursive: true });
  for (const subdir of SUBDIRS) {
    fs.mkdirSync(path.join(bproPath, subdir), { recursive: true });
  }

  const config: BproConfig = {
    ...DEFAULT_CONFIG,
    project_name: path.basename(root),
    created: new Date().toISOString(),
  };
  saveConfig(bproPath, config);

  // Initialize empty models registry
  const modelsRegistry: ModelsRegistry = {
    version: 1,
    models: [],
  };
  saveModels(bproPath, modelsRegistry);

  // .gitignore for credential protection
  fs.writeFileSync(path.join(bproPath, '.gitignore'), GITIGNORE_CONTENT, 'utf-8');

  return bproPath;
}

// --- Config ---

export function loadConfig(bproPath: string): BproConfig {
  const configPath = path.join(bproPath, CONFIG_FILE);
  return loadYaml<BproConfig>(configPath) ?? { ...DEFAULT_CONFIG };
}

export function saveConfig(bproPath: string, config: BproConfig): void {
  saveYaml(path.join(bproPath, CONFIG_FILE), config);
}

// --- Models ---

export function loadModels(bproPath: string): ModelsRegistry {
  const modelsPath = path.join(bproPath, MODELS_FILE);
  return loadYaml<ModelsRegistry>(modelsPath) ?? { version: 1, models: [] };
}

export function saveModels(bproPath: string, registry: ModelsRegistry): void {
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
  saveYaml(path.join(bproPath, MODELS_FILE), safeRegistry);
}

/**
 * Save models WITHOUT redacting keys (for internal use).
 */
export function saveModelsRaw(bproPath: string, registry: ModelsRegistry): void {
  saveYaml(path.join(bproPath, MODELS_FILE), registry);
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

export function loadSpecs(bproPath: string): ReqSpec[] {
  const specsDir = path.join(bproPath, 'specs');
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

export function saveSpec(bproPath: string, req: ReqSpec): void {
  const specsDir = path.join(bproPath, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  saveYaml(path.join(specsDir, `${req.id}.yaml`), req);
}

// --- Matrix ---

export interface TraceMatrix {
  version: number;
  created: string;
  entries: Record<string, { code_refs: string[]; test_refs: string[] }>;
}

export function loadMatrix(bproPath: string): TraceMatrix | null {
  return loadYaml<TraceMatrix>(path.join(bproPath, 'matrix', 'matrix.yaml'));
}

export function saveMatrix(bproPath: string, matrix: TraceMatrix): void {
  const matrixDir = path.join(bproPath, 'matrix');
  fs.mkdirSync(matrixDir, { recursive: true });
  saveYaml(path.join(matrixDir, 'matrix.yaml'), matrix);
}
