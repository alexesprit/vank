import { spawn } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { readTargetManifest, selectTargets } from '../src/targets.ts';

interface Options {
  manifest: string;
  targets?: string[];
  quiet: boolean;
  verbose: boolean;
}

function parseOptions(): Options {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string', default: 'builder/targets.json' },
      target: { type: 'string', multiple: true },
      quiet: { type: 'boolean' },
      verbose: { type: 'boolean' },
    },
  });
  return {
    manifest: values.manifest ?? 'builder/targets.json',
    targets: values.target,
    quiet: Boolean(values.quiet),
    verbose: Boolean(values.verbose),
  };
}

function buildTarget(
  target: Awaited<ReturnType<typeof selectTargets>>[number],
  options: Options,
): Promise<void> {
  const args = [
    resolvePath('builder/src/cli.ts'),
    'build',
    '--config',
    target.config,
    '--data-dir',
    target.dataDir,
    '--output',
    target.output,
    ...(target.enrichment === 'none' ? ['--no-ai'] : []),
    ...(target.checks.includes('audience') ? [] : ['--no-audience']),
    ...(target.checks.includes('achievements') ? [] : ['--no-achievements']),
    ...(options.quiet ? ['--quiet'] : []),
    ...(options.verbose ? ['--verbose'] : []),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
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
}

const options = parseOptions();
const manifest = await readTargetManifest(options.manifest);
for (const target of selectTargets(manifest, options.targets)) {
  console.log(`Building dictionary target: ${target.id}`);
  await buildTarget(target, options);
}
