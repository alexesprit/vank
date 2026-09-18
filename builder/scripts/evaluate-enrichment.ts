import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type EnrichmentProvider, enrichWords } from '../src/enrichment.ts';
import {
  evaluateEnrichment,
  parseEnrichmentReferences,
  validateEnrichmentReferences,
} from '../src/enrichment-eval.ts';
import { parseRawWords, readJson, writeJson } from '../src/io.ts';
import {
  deriveMetadata,
  mergeSources,
  validateDataset,
} from '../src/pipeline.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    model: { type: 'string' },
    endpoint: { type: 'string' },
    language: { type: 'string', default: 'ru' },
    source: {
      type: 'string',
      default: 'builder/evals/enrichment/source.json',
    },
    reference: {
      type: 'string',
      default: 'builder/evals/enrichment/reference.json',
    },
    output: { type: 'string' },
    'batch-size': { type: 'string', default: '10' },
    concurrency: { type: 'string', default: '1' },
    'max-retries': { type: 'string', default: '2' },
  },
});

async function main() {
  const envValue = (value: string | undefined) => value?.trim() || undefined;
  const providerValue = String(
    values.provider ?? envValue(process.env.AI_PROVIDER) ?? 'openrouter',
  );
  if (!['openrouter', 'ollama'].includes(providerValue))
    throw new Error(`Invalid AI provider: ${providerValue}`);
  const provider = providerValue as EnrichmentProvider;
  const model = String(
    values.model ??
      envValue(process.env.AI_MODEL) ??
      (provider === 'ollama'
        ? (envValue(process.env.OLLAMA_MODEL) ?? '')
        : (envValue(process.env.OPENROUTER_MODEL) ?? '')),
  );
  if (!model) throw new Error('Set AI_MODEL or the provider model variable');
  const language = String(values.language ?? 'ru');
  const source = parseRawWords(await readJson(String(values.source)));
  const deterministic = deriveMetadata(mergeSources(source).words);
  const references = parseEnrichmentReferences(
    await readJson(String(values.reference)),
    language,
  );
  validateEnrichmentReferences(deterministic, references);
  const apiKey =
    provider === 'ollama'
      ? (process.env.OLLAMA_API_KEY ?? '')
      : (process.env.OPENROUTER_API_KEY ?? '');
  const enriched = await enrichWords(deterministic, {
    provider,
    model,
    apiKey,
    endpoint: values.endpoint ?? envValue(process.env.AI_ENDPOINT),
    languages: [language],
    batchSize: Number(values['batch-size'] ?? 10),
    concurrency: Number(values.concurrency ?? 1),
    maxRetries: Number(values['max-retries'] ?? 2),
  });
  const metrics = evaluateEnrichment(enriched, references, language);
  const dictionary = validateDataset(enriched);
  const result = {
    provider,
    model,
    language,
    metrics,
    validWords: dictionary.words.length,
  };
  if (values.output) await writeJson(String(values.output), result);
  else console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
