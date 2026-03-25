/**
 * T-shirt Sizing — project diagnosis based on ch02-project-sizing.md
 *
 * XS: side project, 1 person, <10 REQs, <5K LOC
 * S:  small project, 1-2 people, 10-30 REQs, 5K-20K LOC
 * M:  medium project, 2-5 people, 30-100 REQs, 20K-100K LOC
 * L:  large project, 5-10 people, 100-500 REQs, 100K-500K LOC
 * XL: enterprise, 10+ people, 500+ REQs, 500K+ LOC
 */

import fs from 'node:fs';
import path from 'node:path';

export type ProjectSize = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface SizingResult {
  size: ProjectSize;
  metrics: {
    reqs: number;
    loc: number;
    files: number;
    agents: number;
    tasks: number;
  };
  methodology: MethodologySet;
  reason: string;
}

export interface MethodologySet {
  crosscheckRequired: boolean;
  gateScoring: boolean;
  formalDelivery: boolean;
  pmoAudit: boolean;
  escalationFramework: boolean;
  performanceTracking: boolean;
  minDeliverables: string[];
}

const METHODOLOGY_MAP: Record<ProjectSize, MethodologySet> = {
  XS: {
    crosscheckRequired: false,
    gateScoring: false,
    formalDelivery: false,
    pmoAudit: false,
    escalationFramework: false,
    performanceTracking: false,
    minDeliverables: ['D.02', 'D.05'],
  },
  S: {
    crosscheckRequired: false,
    gateScoring: true,
    formalDelivery: false,
    pmoAudit: false,
    escalationFramework: false,
    performanceTracking: false,
    minDeliverables: ['D.02', 'D.03', 'D.05', 'D.06'],
  },
  M: {
    crosscheckRequired: true,
    gateScoring: true,
    formalDelivery: true,
    pmoAudit: false,
    escalationFramework: true,
    performanceTracking: true,
    minDeliverables: ['D.01', 'D.02', 'D.03', 'D.05', 'D.06', 'D.07'],
  },
  L: {
    crosscheckRequired: true,
    gateScoring: true,
    formalDelivery: true,
    pmoAudit: true,
    escalationFramework: true,
    performanceTracking: true,
    minDeliverables: ['D.01', 'D.02', 'D.03', 'D.04', 'D.05', 'D.06', 'D.07', 'D.08'],
  },
  XL: {
    crosscheckRequired: true,
    gateScoring: true,
    formalDelivery: true,
    pmoAudit: true,
    escalationFramework: true,
    performanceTracking: true,
    minDeliverables: ['D.01', 'D.02', 'D.03', 'D.04', 'D.05', 'D.06', 'D.07', 'D.08'],
  },
};

export function diagnoseSize(metrics: {
  reqs: number;
  loc: number;
  files: number;
  agents: number;
  tasks: number;
}): SizingResult {
  let size: ProjectSize;
  let reason: string;

  if (metrics.reqs > 500 || metrics.loc > 500_000) {
    size = 'XL';
    reason = `${metrics.reqs} REQs, ${formatLoc(metrics.loc)} LOC — enterprise scale`;
  } else if (metrics.reqs > 100 || metrics.loc > 100_000) {
    size = 'L';
    reason = `${metrics.reqs} REQs, ${formatLoc(metrics.loc)} LOC — large project`;
  } else if (metrics.reqs > 30 || metrics.loc > 20_000) {
    size = 'M';
    reason = `${metrics.reqs} REQs, ${formatLoc(metrics.loc)} LOC — medium project`;
  } else if (metrics.reqs > 10 || metrics.loc > 5_000) {
    size = 'S';
    reason = `${metrics.reqs} REQs, ${formatLoc(metrics.loc)} LOC — small project`;
  } else {
    size = 'XS';
    reason = `${metrics.reqs} REQs, ${formatLoc(metrics.loc)} LOC — side project`;
  }

  return {
    size,
    metrics,
    methodology: METHODOLOGY_MAP[size],
    reason,
  };
}

export function checkSizeUpgrade(currentSize: ProjectSize, newMetrics: {
  reqs: number;
  loc: number;
  files: number;
  agents: number;
  tasks: number;
}): { upgraded: boolean; from: ProjectSize; to: ProjectSize; reason: string } | null {
  const newSizing = diagnoseSize(newMetrics);
  const sizeOrder: ProjectSize[] = ['XS', 'S', 'M', 'L', 'XL'];

  if (sizeOrder.indexOf(newSizing.size) > sizeOrder.indexOf(currentSize)) {
    return {
      upgraded: true,
      from: currentSize,
      to: newSizing.size,
      reason: `Project grew: ${newSizing.reason}. New methodology requirements apply.`,
    };
  }
  return null;
}

export function countLoc(root: string, includes: string[], excludes: string[]): number {
  let total = 0;
  const { minimatch } = require('../utils/glob.js') as { minimatch: (f: string, p: string) => boolean };

  function walk(dir: string): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full);

        if (entry.isDirectory()) {
          if (!excludes.some(ex => minimatch(rel, ex))) walk(full);
        } else if (entry.isFile()) {
          if (includes.some(inc => minimatch(entry.name, inc.replace('**/', ''))) &&
              !excludes.some(ex => minimatch(rel, ex))) {
            try {
              const content = fs.readFileSync(full, 'utf-8');
              total += content.split('\n').length;
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* permission */ }
  }

  walk(root);
  return total;
}

function formatLoc(loc: number): string {
  if (loc >= 1_000_000) return `${(loc / 1_000_000).toFixed(1)}M`;
  if (loc >= 1_000) return `${(loc / 1_000).toFixed(1)}K`;
  return String(loc);
}
