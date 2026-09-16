import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { parseDictionary } from '../../shared/schema.ts';
import { runtimeDictionary } from '../src/runtime.ts';
import {
  type DictionaryTarget,
  readTargetManifest,
  selectTargets,
  type TargetManifest,
  targetEnvironment,
} from '../src/targets.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

interface Options {
  manifest: string;
  targets?: string[];
  quiet: boolean;
  verbose: boolean;
  curatedOnly: boolean;
  noAi: boolean;
  pack: boolean;
}

function parseOptions(): Options {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string', default: 'builder/targets.json' },
      target: { type: 'string', multiple: true },
      quiet: { type: 'boolean' },
      verbose: { type: 'boolean' },
      'curated-only': { type: 'boolean' },
      'no-ai': { type: 'boolean' },
      pack: { type: 'boolean' },
    },
  });
  if (values.pack && values.target?.length)
    throw new Error('--pack cannot be combined with --target');
  return {
    manifest: values.manifest ?? 'builder/targets.json',
    targets: values.target,
    quiet: Boolean(values.quiet),
    verbose: Boolean(values.verbose),
    curatedOnly: Boolean(values['curated-only']),
    noAi: Boolean(values['no-ai']),
    pack: Boolean(values.pack),
  };
}

function runtimeContent(data: Buffer): string {
  const dictionary = runtimeDictionary(
    parseDictionary(JSON.parse(data.toString('utf8'))),
  );
  return JSON.stringify({
    version: dictionary.version,
    schemaVersion: dictionary.schemaVersion,
    words: dictionary.words,
  });
}

function previousRuntimeContent(data: Buffer): string | undefined {
  try {
    return runtimeContent(data);
  } catch {
    return undefined;
  }
}

function buildTargets(
  manifest: TargetManifest,
  options: Options,
): DictionaryTarget[] {
  if (!options.pack && !options.targets) return selectTargets(manifest);
  const targets = options.pack
    ? Object.values(manifest.targets).filter(
        (target) => target.enabled && target.pack,
      )
    : (options.targets ?? []).map((id) => {
        const target = manifest.targets[id];
        if (!target) throw new Error(`Unknown dictionary target: ${id}`);
        if (!target.enabled)
          throw new Error(`Dictionary target is disabled: ${id}`);
        return target;
      });
  if (!targets.length)
    throw new Error('At least one dictionary target is required');
  return targets;
}

async function buildTarget(
  target: Awaited<ReturnType<typeof selectTargets>>[number],
  options: Options,
): Promise<void> {
  const previous = existsSync(target.output)
    ? await readFile(target.output)
    : undefined;
  const dataDir =
    options.curatedOnly && target.id === 'words'
      ? 'builder/data/seed'
      : target.dataDir;
  const args = [
    resolvePath('builder/src/cli.ts'),
    'build',
    '--config',
    target.config,
    '--data-dir',
    dataDir,
    '--output',
    target.output,
    ...(target.enrichment === 'none' ? ['--no-ai'] : []),
    ...(options.curatedOnly ? ['--curated-only'] : []),
    ...(options.noAi ? ['--no-ai'] : []),
    ...(target.checks.includes('audience') ? [] : ['--no-audience']),
    ...(target.checks.includes('achievements') ? [] : ['--no-achievements']),
    ...(options.quiet ? ['--quiet'] : []),
    ...(options.verbose ? ['--verbose'] : []),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      env: targetEnvironment(target, process.env),
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Dictionary target ${target.id} failed (${signal ?? `exit ${code ?? 'unknown'}`})`,
          ),
        );
    });
  });
  const previousContent = previous
    ? previousRuntimeContent(previous)
    : undefined;
  if (
    previous &&
    previousContent !== undefined &&
    previousContent === runtimeContent(await readFile(target.output))
  ) {
    const temp = `${target.output}.${process.pid}.tmp`;
    await writeFile(temp, previous);
    await rename(temp, target.output);
  }
}

const options = parseOptions();
const manifest = await readTargetManifest(options.manifest);
for (const target of buildTargets(manifest, options)) {
  console.log(`Building dictionary target: ${target.id}`);
  await buildTarget(target, options);
}
