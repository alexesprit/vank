import { readJson } from './io.ts';

export type EnrichmentMode = 'none' | 'openrouter';
export type TargetCheck = 'audience' | 'achievements';

export interface DictionaryTarget {
  id: string;
  enabled: boolean;
  required: boolean;
  config: string;
  dataDir: string;
  output: string;
  asset: string;
  enrichment: EnrichmentMode;
  checks: TargetCheck[];
}

export interface TargetManifest {
  targets: Record<string, DictionaryTarget>;
}

const nonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Invalid target ${field}`);
  return value;
};

export function parseTargetManifest(value: unknown): TargetManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected target manifest object');
  const rawTargets = (value as { targets?: unknown }).targets;
  if (
    !rawTargets ||
    typeof rawTargets !== 'object' ||
    Array.isArray(rawTargets)
  )
    throw new Error('Expected target manifest targets');
  const targets: Record<string, DictionaryTarget> = {};
  const assets = new Set<string>();
  const outputs = new Set<string>();
  for (const [id, value] of Object.entries(rawTargets)) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`Invalid target ${id}`);
    const target = value as Record<string, unknown>;
    const checks = target.checks ?? [];
    if (
      !Array.isArray(checks) ||
      checks.some((check) => check !== 'audience' && check !== 'achievements')
    )
      throw new Error(`Invalid checks for target ${id}`);
    const enrichment = target.enrichment ?? 'none';
    if (enrichment !== 'none' && enrichment !== 'openrouter')
      throw new Error(`Invalid enrichment for target ${id}`);
    const asset = nonEmptyString(target.asset, 'asset');
    const output = nonEmptyString(target.output, 'output');
    if (assets.has(asset)) throw new Error(`Duplicate target asset: ${asset}`);
    if (outputs.has(output))
      throw new Error(`Duplicate target output: ${output}`);
    assets.add(asset);
    outputs.add(output);
    targets[id] = {
      id,
      enabled: target.enabled !== false,
      required: target.required === true,
      config: nonEmptyString(target.config, 'config'),
      dataDir: nonEmptyString(target.dataDir, 'dataDir'),
      output,
      asset,
      enrichment,
      checks: [...checks] as TargetCheck[],
    };
  }
  return { targets };
}

export async function readTargetManifest(
  path: string,
): Promise<TargetManifest> {
  return parseTargetManifest(await readJson(path));
}

export function selectTargets(
  manifest: TargetManifest,
  requested?: string[],
): DictionaryTarget[] {
  const ids =
    requested ??
    Object.keys(manifest.targets).filter((id) => manifest.targets[id].enabled);
  const selected = ids.map((id) => {
    const target = manifest.targets[id];
    if (!target) throw new Error(`Unknown dictionary target: ${id}`);
    if (!target.enabled)
      throw new Error(`Dictionary target is disabled: ${id}`);
    return target;
  });
  if (!selected.length)
    throw new Error('At least one dictionary target is required');
  for (const target of Object.values(manifest.targets))
    if (target.required && !selected.includes(target))
      throw new Error(`Required dictionary target is missing: ${target.id}`);
  return selected;
}
