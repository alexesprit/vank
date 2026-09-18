import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeArmenian } from '../../shared/armenian.ts';
import { object, parseWord, strings } from '../../shared/schema.ts';
import { validateAchievementDictionary } from '../../web/src/core/achievements.ts';
import {
  type AudiencePolicy,
  composeAudience,
  countLetterCoverage,
  isFamiliar,
  parseAudience,
  shortlistAudience,
} from './audience.ts';
import { applyWordBlacklist, parseWordBlacklist } from './blacklist.ts';
import { type EnrichmentProvider, enrichWords } from './enrichment.ts';
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
      'no-audience': { type: 'boolean' },
      'no-achievements': { type: 'boolean' },
      'curated-only': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  const stage = positionals[0] ?? 'build';
  if (values.help) {
    console.log(
      'Vank builder: fetch | normalize | derive | enrich | validate | build\nOptions: --config FILE --data-dir DIR --output FILE --no-ai --no-audience --no-achievements --curated-only --quiet --verbose',
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
  const maxWords = config.maxWords;
  if (
    maxWords !== undefined &&
    (typeof maxWords !== 'number' ||
      !Number.isInteger(maxWords) ||
      maxWords < 1)
  )
    throw new Error('Invalid dictionary size');
  let audience: AudiencePolicy | undefined;
  if (
    config.audience !== undefined &&
    !values['curated-only'] &&
    !values['no-audience']
  ) {
    if (maxWords === undefined)
      throw new Error(
        'maxWords is required when audience selection is enabled',
      );
    audience = parseAudience(config.audience, languages, maxWords);
  }
  const audienceLimit = maxWords ?? 0;
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
    const blacklistPath = file('blacklist');
    if (existsSync(blacklistPath)) {
      const blacklist = parseWordBlacklist(await readJson(blacklistPath));
      const filtered = applyWordBlacklist(deterministic, blacklist);
      deterministic = filtered.words;
      rejects.push(
        ...filtered.blocked.map((word) => ({
          id: word.id,
          word: word.word,
          source: 'blacklist',
          reason: ['blacklist'],
        })),
      );
      report({
        stage: 'blacklist',
        processed: filtered.blocked.length,
        total: filtered.words.length + filtered.blocked.length,
        rejected: filtered.blocked.length,
        detail: `complete: ${filtered.blocked.length} entries blocked`,
      });
      await writeJson(file('rejected'), rejects);
    }
    let enriched: BuildWord[];
    if (values['no-ai']) enriched = deterministic;
    else {
      const envValue = (value: string | undefined) =>
        value?.trim() || undefined;
      const providerValue = envValue(process.env.AI_PROVIDER) ?? 'openrouter';
      if (!['openrouter', 'ollama'].includes(providerValue))
        throw new Error(`Invalid AI provider: ${providerValue}`);
      const provider = providerValue as EnrichmentProvider,
        model =
          envValue(process.env.AI_MODEL) ??
          (provider === 'ollama'
            ? (envValue(process.env.OLLAMA_MODEL) ?? '')
            : (envValue(process.env.OPENROUTER_MODEL) ?? '')),
        apiKey =
          provider === 'ollama'
            ? (process.env.OLLAMA_API_KEY ?? '')
            : (process.env.OPENROUTER_API_KEY ?? ''),
        concurrency = Number(
          envValue(process.env.AI_CONCURRENCY) ??
            envValue(process.env.OPENROUTER_CONCURRENCY) ??
            3,
        ),
        batchSizeValue = envValue(process.env.AI_BATCH_SIZE),
        batchSize =
          batchSizeValue === undefined ? undefined : Number(batchSizeValue);
      enriched = await enrichWords(deterministic, {
        provider,
        apiKey,
        model,
        endpoint: envValue(process.env.AI_ENDPOINT),
        languages,
        cacheDir: join(directory, '..', 'cache'),
        batchSize,
        concurrency,
        report,
        stopWhen: audience
          ? (words) => {
              if (words.length < audienceLimit) return false;
              const ids = new Set(words.map((word) => word.id));
              if (overrideIds.some((id) => !ids.has(id))) return false;
              const overridden = applyOverrides(words, overrides);
              if (
                overridden.filter((word) => isFamiliar(word, audience.language))
                  .length <
                Math.max(
                  audience.minFamiliarWords,
                  Math.ceil(audienceLimit * audience.minFamiliarShare),
                )
              )
                return false;
              const selected = composeAudience(
                overridden,
                audienceLimit,
                audience,
              );
              return (
                selected.length === audienceLimit &&
                countLetterCoverage(selected).every(
                  ({ words }) => words >= audience.minLetterCoverage,
                )
              );
            }
          : undefined,
      });
    }
    await writeJson(file('enriched'), enriched);
    if (stage === 'enrich') return;
  }
  if (stage === 'validate' || stage === 'build') {
    try {
      // Recompute AI/manual review rejects; rerunning validation must not count them twice.
      rejects = rejects.filter(
        (r) => !('id' in object(r)) || object(r).source === 'blacklist',
      );
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
        ? composeAudience(overridden, audienceLimit, audience)
        : composeDataset(
            overridden,
            maxWords ?? Math.max(1, overridden.length),
          );
      if (audience) {
        const familiar = selected.filter((w) =>
          isFamiliar(w, audience.language),
        );
        const familiarCoverage = new Map(
          countLetterCoverage(familiar).map(({ letter, words }) => [
            letter,
            words,
          ]),
        );
        const verificationCoverage = new Map(
          countLetterCoverage(
            selected.filter(
              (word) => (word.familiarity?.[audience.language] ?? 1) <= 0.4,
            ),
          ).map(({ letter, words }) => [letter, words]),
        );
        const coverage = countLetterCoverage(selected).map(
          ({ letter, words }) => ({
            letter,
            words,
            familiar: familiarCoverage.get(letter) ?? 0,
            verification: verificationCoverage.get(letter) ?? 0,
          }),
        );
        const quality = {
          language: audience.language,
          total: selected.length,
          maxWords: audienceLimit,
          familiar: familiar.length,
          familiarShare: familiar.length / selected.length,
          coverage,
        };
        await writeJson(file('audience-report'), quality);
        if (!values.quiet)
          console.log(
            `Alphabet coverage (words): ${coverage
              .map(({ letter, words }) => `${letter}:${words}`)
              .join(' ')}`,
          );
        if (coverage.some((c) => c.words < audience.minLetterCoverage))
          throw new Error(
            `Audience quality: every Armenian letter needs at least ${audience.minLetterCoverage} words; see audience-report.json`,
          );
        report({
          stage: 'audience',
          processed: familiar.length,
          total: selected.length,
          detail: 'complete: familiar words; alphabet coverage checked',
        });
      }
      const dictionary = validateDataset(selected);
      if (!values['no-achievements']) {
        validateAchievementDictionary(dictionary.words);
        report({
          stage: 'achievements',
          processed: dictionary.words.length,
          total: dictionary.words.length,
          detail: 'complete: achievement prerequisites verified',
        });
      }
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
