# Vank

A static, CAPS-only Modern Eastern Armenian reading trainer for Russian-speaking
beginners. Type a reading in Cyrillic or Latin, press Enter to check, and Enter
again for the next word. “Не знаю” reveals the reading and records a skip.

## Run

Node.js 24 or later:

```sh
npm ci
npm run dev
npm run test:run
npm run build
npm run preview
```

`web/data/words.json` is a downloaded build artifact and is not stored in Git.
Set `DICTIONARY_URL` to an immutable HTTPS artifact URL and
`DICTIONARY_SHA256` to its SHA-256 digest in `.env` locally and in the Vercel
project settings for Preview and Production. The `dev`, `test`, and `build`
scripts download and validate the dictionary automatically. A locally built
dictionary can be used without these variables while the file exists.

To publish a new dictionary, run `npm run build:dictionary`, upload
`web/data/words.json` to object storage or a release, calculate its digest with
`shasum -a 256 web/data/words.json`, update both environment variables, and
redeploy. Vercel needs no storage SDK; its normal build emits the downloaded
dictionary into `web/dist/`.

Deploy `web/dist/` to any static host. Asset URLs are relative, including the
versioned dictionary, so deployment under a GitHub Pages repository path works.
No backend, account, runtime AI, external fonts, or external learner telemetry.
Progress and raw attempt events stay in IndexedDB on the current browser origin.

`npm test` runs Vitest in watch mode. Tests use offline fixtures and
fake-indexeddb; they do not call Wiktionary or OpenRouter.

## Dictionary builder

The dictionary targets Russian-recognizable vocabulary, with a maximum of 1,000
words. The current build contains **1,000 words: 700 highly familiar (70%) and
300 verification words**, with every written alphabet letter appearing at least
twice. Familiarity scores are curated or AI estimates, not learner-study results.
A separate 79-word curated seed remains available for offline development.

```sh
npm run build:seed                 # reproducible curated-only runtime dictionary
npm run fetch                     # download/cache source exports and save raw.json
npm run normalize                 # re-read raw.json; normalize and merge fields
npm run derive                    # read normalized.json; derive technical metadata
npm run enrich                    # read deterministic.json; cached OpenRouter batches
npm run validate                  # apply overrides, compose, validate, emit words.json
npm run build:dictionary           # all stages; reuse source files and AI item caches
```

Configure sources, explicit priorities, learner languages, and output count in
`builder/config.json`. Source paths are relative to the repository working
directory. The Wiktionary adapter reads structured Wiktextract JSONL extracted
from Wikimedia dumps; it does not scrape HTML. A local export can replace the
configured download. Curated records are first-class vocabulary sources and can
introduce words absent from Wiktionary. Higher-priority sources win only fields
they supply, including individual language-map values. Same-priority duplicate
records use the last supplied field value; definitions and provenance accumulate.

For live enrichment, create an ignored `.env` with the variable names in
`.env.example`, or export `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. The model
must support structured JSON-schema responses. No provider/model is hardcoded.
`ru` is the default enrichment language; adding languages is a configuration change.
The configured audience policy shortlists words **before** AI enrichment:

- `builder/data/recognizable-ru.json` pairs attested Armenian spellings with
  recognition hints and an optional `purpose` (`familiar` or `verification`).
  Hints are hypotheses, not guaranteed familiarity scores. Add reviewed
  concepts here to expand the vocabulary.
- Only matching imported lemmas plus the curated vocabulary enter enrichment;
  missing spellings are reported, never invented. `candidateLimit` caps work
  at 2,100 candidates, with curated words first and shorter words next.
  `selected-names.json` explicitly allows source-attested names through the
  otherwise name-excluding Wiktionary adapter.
- AI receives source definitions, parts of speech, and recognition hints. It
  checks current usage, meaning, recognizability, and beginner usefulness.
- Final composition requires at least **950 accepted words**, including at
  least **700 words with familiarity >= 0.8** and a **70% familiar share**.
  Imported words need AI confidence >= 0.8; flagged words are excluded.
  Usefulness ranks familiar words. Verification words must be explicitly
  selected or curated, have familiarity <= 0.4, and imported verification
  words also need usefulness >= 0.5. Composition reserves up to 300 slots
  for verification words.
- Every written Armenian letter must occur in at least two selected words.
  `audience-report.json` also reports familiar and verification coverage per
  letter; some letters have no natural Russian-recognizable examples.

The limit is a ceiling, not a target to pad with arbitrary words. Quality-gate
failure leaves the previous runtime dictionary intact. `candidates.json` records
the shortlist and missing candidates. The concept list is reviewed and intentionally finite; it does not exhaust
all Armenian loanwords. The optional `node builder/scripts/discover.ts` command
uses the configured AI model to screen derived source entries in cached batches
and writes `builder/data/discovery-proposals.json`. Review proposals before
adding them to the candidate list; discovery never promotes them automatically.
The curated `ԿՈՄԲՈ` entry is attested at https://artlunch.am/menu.

```sh
npm run build:dictionary -- --curated-only --no-ai --output /tmp/vank-review/words.json
npm run enrich -- --verbose
npm run validate -- --quiet
```

`--no-ai` explicitly skips AI for seed/fixture/review builds. It does not claim
missing semantic scores have been estimated. A full audience build without AI
can fail its familiarity gate; use `--curated-only` for the offline seed. All commands support `--quiet`,
`--verbose`, `--config FILE`, `--data-dir DIR`, and `--output FILE`.
`--curated-only` excludes external sources. `--help` lists stages and options.

Intermediate files (`raw`, `normalized`, `deterministic`, `enriched`, `words`,
`rejected`) remain separate under the selected data directory. Successful AI
items are cached individually in the sibling `cache/` directory, keyed by word
identity/reading, source definitions, parts of speech, recognition hints, model,
learner languages, prompt version, and AI schema version.
Changing batch size or restarting after a failed batch reuses successful items.
Invalid AI JSON, mismatched IDs, and invalid category/score data are rejected.
Transient failures have bounded retries and request timeouts. Progress reports
counts, percentage when the total is known, batches, cache/API work, rejected
entries, execution/API failures, retries, elapsed time, and ETA based on newly
processed work rather than cache hits. Source exclusions and flagged words
count as rejections, not failures; repeated validation does not duplicate them.

Put corrections in `builder/data/overrides.json`, keyed by the stable word ID:

```json
{
  "hy-54f-531-554-54d-53b": {
    "familiarity": {"ru": 1},
    "acceptedLatin": ["taksi", "taxi"],
    "categories": ["transport"]
  }
}
```

Overrides run after enrichment and before composition/validation. Curated
technical fields such as IDs, letters, units, and canonical readings are derived
locally, even if an AI authored the source file. Curated semantic corrections
are retained during enrichment. Optional pronunciation corrections must retain
consistent source units and accepted readings; invalid output fails the build
without replacing the previous runtime dictionary.

Imported entries retain source URLs, licensing, definitions, per-field metadata
provenance, and AI version/model metadata. The builder writes attribution beside
its output as an ignored local sidecar. The committed
`web/public/ATTRIBUTION.txt` is copied into every static deployment. Licensing
references and the changes to imported material are recorded there.

## Implementation boundaries

- `shared/`: canonical Eastern Armenian alphabet, dictionary types and validation.
- `web/src/core/`: pure normalization/alignment, EMA scoring, difficulty,
  deterministic adaptive selection, and attempt construction.
- `web/src/storage/`: versioned IndexedDB repositories and atomic attempt/progress saves.
- `web/src/data/`: static dictionary loading and runtime validation.
- `web/src/ui/`: rendering and input; `trainer.ts` coordinates core and persistence.
- `builder/src/`: source adapters, independent pipeline stages, AI enrichment,
  cache/file IO, and CLI reporting.

Algorithm coefficients live in `web/src/core/config.ts`. Bootstrap uses short,
familiar words. Once enough letters have positive evidence, candidates contain
at most one unknown written letter; introductions schedule three reinforcement
attempts where the dictionary supplies eligible alternatives. Familiar-word
answers are discounted, and strong letters require lower-familiarity evidence.
Unknown readings and ambiguous alignment do not fabricate recognition credit.

Readings use a simple learner notation, not IPA: `kh` for Խ, `gh` for Ղ, `j` for
Ջ, `ts` for Ծ/Ց, `y` for Ը/Յ, with explicit Cyrillic forms and accepted aliases.
`ՈՒ` is one pronunciation unit while evidence is retained for both written
characters. Aspiration distinctions are not required in typed answers. Eastern
sound values and position-sensitive vowels are tested. Lexical pronunciation
exceptions require reviewed dictionary corrections; AI cannot rewrite readings.

Part F features remain out of scope: no typography modes, response-time scoring,
achievements, confusion engine, images, extra training modes, or backend sync.
Attempt UUIDs, client identity, timestamps, raw answers, and alignment are retained
for future use without building those features now.
