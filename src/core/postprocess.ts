/**
 * Post-processing pipeline for generated requirements.
 *
 * Runs after decompose/snapshot to improve quality:
 * 1. Deduplicate similar requirements (Jaccard similarity)
 * 2. Validate code_refs (check file existence)
 * 3. Adjust priority distribution (cap HIGH ratio)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ReqSpec, FugueConfig } from './project.js';

export interface PostProcessResult {
  merged: number;       // duplicate-merged count
  invalidRefs: number;  // removed code_ref count
  priorityAdjusted: number;  // priority-adjusted count
}

// =============================================
// Jaccard similarity
// =============================================

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

// =============================================
// 1. Deduplicate requirements
// =============================================

const SIMILARITY_THRESHOLD = 0.7;

/**
 * Merge requirements whose title+description are >= 70% similar (Jaccard).
 * Later duplicates are removed; their code_refs are merged into the earlier one.
 */
export function deduplicateReqs(reqs: ReqSpec[]): { reqs: ReqSpec[]; merged: number } {
  const kept: ReqSpec[] = [];
  const removedIndices = new Set<number>();

  for (let i = 0; i < reqs.length; i++) {
    if (removedIndices.has(i)) continue;

    const current = { ...reqs[i] };
    const currentText = `${current.title} ${current.description}`;

    for (let j = i + 1; j < reqs.length; j++) {
      if (removedIndices.has(j)) continue;

      const candidate = reqs[j];
      const candidateText = `${candidate.title} ${candidate.description}`;
      const sim = jaccardSimilarity(currentText, candidateText);

      if (sim >= SIMILARITY_THRESHOLD) {
        // Merge code_refs from duplicate into current
        const mergedRefs = new Set([
          ...(current.code_refs ?? []),
          ...(candidate.code_refs ?? []),
        ]);
        current.code_refs = [...mergedRefs];

        // Merge test_refs
        const mergedTests = new Set([
          ...(current.test_refs ?? []),
          ...(candidate.test_refs ?? []),
        ]);
        current.test_refs = [...mergedTests];

        removedIndices.add(j);
      }
    }

    kept.push(current);
  }

  return { reqs: kept, merged: removedIndices.size };
}

// =============================================
// 2. Validate code_refs
// =============================================

/**
 * Remove code_refs that don't exist on disk. Log warnings.
 */
export function validateCodeRefs(
  reqs: ReqSpec[],
  projectRoot: string,
): { reqs: ReqSpec[]; invalidRefs: number } {
  let invalidRefs = 0;

  const result = reqs.map((req) => {
    if (!req.code_refs || req.code_refs.length === 0) return req;

    const validRefs: string[] = [];
    for (const ref of req.code_refs) {
      const absPath = path.isAbsolute(ref) ? ref : path.join(projectRoot, ref);
      if (fs.existsSync(absPath)) {
        validRefs.push(ref);
      } else {
        invalidRefs++;
        // Warning logged to stderr so it doesn't break JSON output
        console.warn(`[postprocess] ${req.id}: removed invalid code_ref "${ref}"`);
      }
    }

    return { ...req, code_refs: validRefs };
  });

  return { reqs: result, invalidRefs };
}

// =============================================
// 3. Priority adjustment
// =============================================

const DEFAULT_MAX_HIGH_RATIO = 0.30;

/**
 * Cap HIGH priority at maxHighRatio of total.
 * "Weak" HIGHs (short description or no code_refs) are demoted to MEDIUM first.
 */
export function adjustPriorities(
  reqs: ReqSpec[],
  maxHighRatio: number = DEFAULT_MAX_HIGH_RATIO,
): { reqs: ReqSpec[]; adjusted: number } {
  const total = reqs.length;
  if (total === 0) return { reqs, adjusted: 0 };

  const maxHigh = Math.floor(total * maxHighRatio);
  const highReqs = reqs.filter((r) => r.priority === 'HIGH');

  if (highReqs.length <= maxHigh) {
    return { reqs: [...reqs], adjusted: 0 };
  }

  // Score HIGHs — lower score = weaker (demote first)
  const scored = highReqs.map((r) => ({
    id: r.id,
    score: (r.description?.length ?? 0) + (r.code_refs?.length ?? 0) * 50,
  }));
  scored.sort((a, b) => a.score - b.score);

  // Demote weakest HIGHs
  const toDemote = scored.slice(0, highReqs.length - maxHigh).map((s) => s.id);
  const demoteSet = new Set(toDemote);

  const result = reqs.map((r) => {
    if (demoteSet.has(r.id)) {
      return { ...r, priority: 'MEDIUM' };
    }
    return r;
  });

  return { reqs: result, adjusted: demoteSet.size };
}

// =============================================
// Full pipeline
// =============================================

/**
 * Run all post-processing steps on a requirement array.
 * Config-driven: uses generation.priority_rules.max_high_ratio and
 * generation.code_ref_validation settings when present.
 */
export function postProcessReqs(
  reqs: ReqSpec[],
  projectRoot: string,
  config: FugueConfig,
): { reqs: ReqSpec[]; stats: PostProcessResult } {
  const gen = config.generation;

  // 1. Deduplicate
  const dedup = deduplicateReqs(reqs);

  // 2. Validate code_refs (if enabled or no config)
  const codeRefEnabled = gen?.code_ref_validation?.enabled !== false;
  let validated: { reqs: ReqSpec[]; invalidRefs: number };
  if (codeRefEnabled) {
    validated = validateCodeRefs(dedup.reqs, projectRoot);
  } else {
    validated = { reqs: dedup.reqs, invalidRefs: 0 };
  }

  // 3. Priority adjustment
  const maxHighRatio = gen?.priority_rules?.max_high_ratio ?? DEFAULT_MAX_HIGH_RATIO;
  const adjusted = adjustPriorities(validated.reqs, maxHighRatio);

  return {
    reqs: adjusted.reqs,
    stats: {
      merged: dedup.merged,
      invalidRefs: validated.invalidRefs,
      priorityAdjusted: adjusted.adjusted,
    },
  };
}
