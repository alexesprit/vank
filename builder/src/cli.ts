import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ALPHABET, normalizeArmenian } from '../../shared/armenian.ts';
import { object, parseWord, strings } from '../../shared/schema.ts';
import {
  composeAudience,
  isFamiliar,
  parseAudience,
  shortlistAudience,
} from './audience.ts';
import { enrichWords } from './enrichment.ts';
import {
  downloadSource,
  parseRawWords,
  readJson,
  readWiktionary,
  writeJson,
} from './io.ts';
import {
  applyOverrides,
  composeDataset,
  deriveMetadata,
  mergeSources,
  validateDataset,
} from './pipeline.ts';
import { createReporter } from './progress.ts';
import { writeRuntimeDictionary } from './runtime.ts';
import { curatedSource } from './sources/curated.ts';
import type { BuildWord, MergedWord, RawWord } from './types.ts';

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', default: 'builder/config.json' },
      'data-dir': { type: 'string', default: 'builder/data' },
      output: { type: 'string', default: 'web/data/words.json' },
      quiet: { type: 'boolean' },
      verbose: { type: 'boolean' },
      'no-ai': { type: 'boolean' },
      'curated-only': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  const stage = positionals[0] ?? 'build';
  if (values.help) {
    console.log(
      'Vank builder: fetch | normalize | derive | enrich | validate | build\nOptions: --config FILE --data-dir DIR --output FILE --no-ai --curated-only --quiet --verbose',
    );
    return;
  }
  if (
    !['fetch', 'normalize', 'derive', 'enrich', 'validate', 'build'].includes(
      stage,
    )
  )
    throw new Error(`Unknown stage: ${stage}`);
  const configPath = values.config ?? 'builder/config.json',
    directory = values['data-dir'] ?? 'builder/data',
    output = values.output ?? 'web/data/words.json';
  const report = createReporter(Boolean(values.quiet), Boolean(values.verbose));
  const config = object(await readJson(configPath)),
    languages = strings(config.learnerLanguages ?? ['ru']);
  if (!languages.length)
    throw new Error('At least one learner language is required');
  for (const language of languages) Intl.getCanonicalLocales(language);
  const maxWords = config.maxWords ?? 1000;
  if (
    typeof maxWords !== 'number' ||
    !Number.isInteger(maxWords) ||
    maxWords < 1
  )
    throw new Error('Invalid dictionary size');
  const audience =
    config.audience === undefined || values['curated-only']
      ? undefined
      : parseAudience(config.audience, languages, maxWords);
  if (!Array.isArray(config.sources))
    throw new Error('Expected source configuration');
  const sources = config.sources
    .map(object)
    .filter((s) => !values['curated-only'] || s.type === 'curated');
  for (const source of sources) {
    if (
      !['curated', 'wiktionary'].includes(String(source.type)) ||
      typeof source.path !== 'string' ||
      typeof source.priority !== 'number' ||
      !Number.isFinite(source.priority)
    )
      throw new Error('Invalid source configuration');
    for (const key of ['url', 'edition', 'names'])
      if (source[key] !== undefined && typeof source[key] !== 'string')
        throw new Error(`Invalid source ${key}`);
  }
  const file = (name: string) => join(directory, `${name}.json`);
  let rejects: unknown[] =
    stage !== 'fetch' && stage !== 'build' && existsSync(file('rejected'))
      ? ((await readJson(file('rejected'))) as unknown[])
      : [];
  if (stage === 'fetch' || stage === 'build') {
    const raw: RawWord[] = [];
    for (const source of sources) {
      const path = source.path as string;
      if (source.type === 'curated')
        raw.push(
          ...curatedSource(await readJson(path), source.priority as number),
        );
      else {
        if (!existsSync(path) && source.url)
          await downloadSource(String(source.url), path, report);
        const allowedNames = source.names
          ? new Set(
              strings(await readJson(String(source.names))).map(
                normalizeArmenian,
              ),
            )
          : undefined;
        const imported = await readWiktionary(
          path,
          {
            priority: source.priority as number,
            datasetUrl: source.url as string | undefined,
            edition: source.edition as string | undefined,
            allowedNames,
          },
          report,
        );
        raw.push(...imported.words);
        rejects.push(...imported.rejected);
      }
    }
    await writeJson(file('raw'), raw);
    await writeJson(file('rejected'), rejects);
    report({
      stage: 'fetch',
      processed: raw.length,
      total: raw.length,
      detail: 'complete',
    });
    if (stage === 'fetch') return;
  }
  if (stage === 'normalize' || stage === 'build') {
    const normalized = mergeSources(
      parseRawWords(await readJson(file('raw'))),
      report,
    );
    rejects.push(...normalized.rejected);
    await writeJson(file('normalized'), normalized.words);
    await writeJson(file('rejected'), rejects);
    if (stage === 'normalize') return;
  }
  if (stage === 'derive' || stage === 'build') {
    const value = await readJson(file('normalized'));
    if (!Array.isArray(value)) throw new Error('Invalid normalized stage');
    // Revalidate persisted stage input rather than trusting a TypeScript cast.
    const merged: MergedWord[] = value.map((value) => {
      const r = object(value);
      if (
        typeof r.word !== 'string' ||
        normalizeArmenian(r.word) !== r.word ||
        !Array.isArray(r.sources)
      )
        throw new Error('Invalid normalized word');
      object(r.metadata);
      object(r.metadataSource);
      strings(r.rawDefinitions);
      strings(r.rawPos);
      for (const source of r.sources)
        if (typeof object(source).type !== 'string')
          throw new Error('Invalid source provenance');
      return r as unknown as MergedWord;
    });
    const derived = deriveMetadata(merged, report);
    await writeJson(file('deterministic'), derived);
    if (stage === 'derive') return;
  }
  const readBuilt = async (name: string): Promise<BuildWord[]> => {
    const value = await readJson(file(name));
    if (!Array.isArray(value)) throw new Error(`Invalid ${name} stage`);
    return value.map((value) => {
      parseWord(value);
      const record = object(value);
      if (!Array.isArray(record.sources) || !record.sources.length)
        throw new Error('Missing build provenance');
      for (const source of record.sources)
        if (typeof object(source).type !== 'string')
          throw new Error('Invalid provenance');
      object(record.metadataSource);
      strings(record.rawDefinitions);
      strings(record.rawPos);
      if (
        record.audiencePurpose !== undefined &&
        !['familiar', 'verification'].includes(String(record.audiencePurpose))
      )
        throw new Error('Invalid candidate purpose');
      if (
        record.recognitionHints !== undefined &&
        Object.values(object(record.recognitionHints)).some(
          (hint) => typeof hint !== 'string' || !hint.trim(),
        )
      )
        throw new Error('Invalid recognition hints');
      return record as unknown as BuildWord;
    });
  };
  const overridesPath = join(directory, 'overrides.json');
  const overrides = existsSync(overridesPath)
    ? await readJson(overridesPath)
    : {};
  const overrideIds = Object.keys(object(overrides));
  if (stage === 'enrich' || stage === 'build') {
    let deterministic = await readBuilt('deterministic');
    if (audience) {
      const shortlist = shortlistAudience(
        deterministic,
        await readJson(audience.candidates),
        audience,
      );
      await writeJson(file('candidates'), shortlist);
      report({
        stage: 'shortlist',
        processed: shortlist.words.length,
        total: deterministic.length,
        detail: `complete: ${shortlist.missing.length} unattested candidates excluded`,
      });
      deterministic = shortlist.words;
    }
    const enriched = values['no-ai']
      ? deterministic
      : await enrichWords(deterministic, {
          apiKey: process.env.OPENROUTER_API_KEY ?? '',
          model: process.env.OPENROUTER_MODEL ?? '',
          languages,
          cacheDir: join(directory, '..', 'cache'),
          concurrency: Number(process.env.OPENROUTER_CONCURRENCY ?? 3),
          report,
          stopWhen: audience
            ? (words) => {
                if (words.length < maxWords) return false;
                const ids = new Set(words.map((word) => word.id));
                if (overrideIds.some((id) => !ids.has(id))) return false;
                const overridden = applyOverrides(words, overrides);
                if (
                  overridden.filter((word) =>
                    isFamiliar(word, audience.language),
                  ).length < audience.minFamiliarWords
                )
                  return false;
                const selected = composeAudience(
                  overridden,
                  maxWords,
                  audience,
                );
                return (
                  selected.length === maxWords &&
                  ALPHABET.every(
                    ({ upper }) =>
                      selected.filter((word) =>
                        word.uniqueLetters.includes(upper),
                      ).length >= 2,
                  )
                );
              }
            : undefined,
        });
    await writeJson(file('enriched'), enriched);
    if (stage === 'enrich') return;
  }
  if (stage === 'validate' || stage === 'build') {
    try {
      // Recompute AI/manual review rejects; rerunning validation must not count them twice.
      rejects = rejects.filter((r) => !('id' in object(r)));
      const words = await readBuilt('enriched');
      const overridden = applyOverrides(words, overrides);
      // Validate every candidate before composition so filtering cannot hide hard errors.
      validateDataset(overridden);
      rejects.push(
        ...overridden
          .filter((w) => w.flags?.length)
          .map((w) => ({ id: w.id, word: w.word, reason: w.flags })),
      );
      const selected = audience
        ? composeAudience(overridden, maxWords, audience)
        : composeDataset(overridden, maxWords);
      if (audience) {
        const familiar = selected.filter((w) =>
          isFamiliar(w, audience.language),
        );
        const coverage = ALPHABET.map(({ upper }) => ({
          letter: upper,
          words: selected.filter((w) => w.uniqueLetters.includes(upper)).length,
          familiar: familiar.filter((w) => w.uniqueLetters.includes(upper))
            .length,
          verification: selected.filter(
            (w) =>
              (w.familiarity?.[audience.language] ?? 1) <= 0.4 &&
              w.uniqueLetters.includes(upper),
          ).length,
        }));
        const quality = {
          language: audience.language,
          total: selected.length,
          maxWords,
          familiar: familiar.length,
          familiarShare: familiar.length / selected.length,
          coverage,
        };
        await writeJson(file('audience-report'), quality);
        if (coverage.some((c) => c.words < 2))
          throw new Error(
            'Audience quality: every Armenian letter needs at least two words; see audience-report.json',
          );
        report({
          stage: 'audience',
          processed: familiar.length,
          total: selected.length,
          detail: 'complete: familiar words; alphabet coverage checked',
        });
      }
      const dictionary = validateDataset(selected);
      await writeJson(file('words'), dictionary);
      await writeJson(file('rejected'), rejects);
      await writeRuntimeDictionary(resolve(output), dictionary);
      const sources = [
        ...new Set(
          selected.flatMap((w) =>
            w.sources
              .filter((s) => s.type !== 'curated')
              .map(
                (s) =>
                  `${s.name ?? s.type}\n${s.url ?? ''}\nLicense: ${s.license ?? 'Review required before redistribution'}`,
              ),
          ),
        ),
      ];
      const attribution = `Vank dictionary\n\nProject-owned curated vocabulary plus the following imported sources.\nImported definitions and derived dataset: CC-BY-SA-4.0 where indicated.\nhttps://creativecommons.org/licenses/by-sa/4.0/\nChanges: uppercase normalization, filtering, source merging, deterministic readings and optional AI metadata.\nSource URLs link to entries and contributor histories. No quotations, audio or images imported.\n\n${sources.join('\n\n')}\n`;
      await mkdir(dirname(output), { recursive: true });
      await writeFile(join(dirname(output), 'ATTRIBUTION.txt'), attribution);
      report({
        stage: 'build',
        processed: selected.length,
        total: selected.length,
        rejected: rejects.length,
        detail: `complete: ${output}`,
      });
    } catch (error) {
      await writeJson(file('rejected'), rejects);
      report({
        stage: 'build',
        processed: 0,
        rejected: rejects.length,
        failures: 1,
        detail: 'failed',
      });
      throw error;
    }
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
