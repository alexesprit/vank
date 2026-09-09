import type { SourceInfo, Word } from '../../shared/types.ts';
export interface RawWord {
  word: string;
  sourceId: string;
  sourcePriority: number;
  source: SourceInfo;
  rawPos?: string[];
  rawDefinitions?: string[];
  rawFrequency?: number;
  metadata?: Record<string, unknown>;
}
export interface MergedWord {
  word: string;
  sources: SourceInfo[];
  metadata: Record<string, unknown>;
  metadataSource: Record<string, string>;
  rawDefinitions: string[];
  rawPos: string[];
  rawFrequency?: number;
}
export interface BuildWord extends Word {
  recognitionHints?: Record<string, string>;
  audiencePurpose?: 'familiar' | 'verification';
  sources: SourceInfo[];
  metadataSource: Record<string, string>;
  rawDefinitions: string[];
  rawPos: string[];
  ai?: {
    model: string;
    promptVersion: number;
    schemaVersion: number;
    confidence: number;
  };
  flags?: string[];
}
export interface StageProgress {
  stage: string;
  processed: number;
  total?: number;
  batch?: number;
  batches?: number;
  cached?: number;
  api?: number;
  rejected?: number;
  failures?: number;
  retries?: number;
  detail?: string;
}
export type Report = (progress: StageProgress) => void;
