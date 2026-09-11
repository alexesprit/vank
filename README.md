# Vank

A static Modern Eastern Armenian reading trainer for Russian-speaking
beginners. Type a reading in Cyrillic or Latin, press Enter to check, and Enter
again for the next word. “Не знаю” reveals the reading and records a skip.
This is a complete client-side training product: it includes
adaptive selection, progress tracking, typography and font practice, flash
recognition, metadata hints, bilingual UI, and local persistence.

Try it online at [vank.alexesprit.com](https://vank.alexesprit.com).

## Run

Node.js 24 or later:

```sh
npm ci
npm run build:seed          # required once in a fresh checkout
npm run dev
npm run test:run
npm run build
npm run preview
```

`web/data/words.json` is a minified build artifact and is not stored in Git.
Run `npm run build:seed` first after cloning (or after removing the artifact),
then local development and tests use that deterministic 79-word dictionary.
`DICTIONARY_URL` and
`DICTIONARY_SHA256` remain available in `.env` when an external artifact is
needed explicitly.

The online deployment resolves the latest GitHub Release `words.json` asset and
its SHA-256 during the GitHub Actions build; no dictionary variables are needed
in Vercel. Publish and redeploy a locally built dictionary with:

```sh
npm run build:dictionary
npm run dictionary:publish
```

`dictionary:publish` reruns the production quality gate from
`builder/config.json` before calling GitHub.

The release contains only the runtime file. Rich provenance and enrichment data
remain in the builder intermediates, including `builder/data/words.json`.
Deterministic letter decomposition is also omitted and reconstructed when the
app validates the downloaded dictionary.

Deploy `web/dist/` to any static host. Asset URLs are relative, including the
versioned dictionary, so deployment under a GitHub Pages repository path works.
No backend, account, or runtime AI. Progress and learner answers never leave
the browser. Optional, cookie-free Vercel Web Analytics is enabled only after a
new learner starts practice with the visible setting on; it is off by default
for existing learners and when Do Not Track is enabled. Optional Armenian fonts
are fetched lazily from Google Fonts only when selected for training.
The small `i18next` runtime dependency is intentional: it provides locale
fallbacks and pluralization without maintaining a second interpolation system.
Interface icons use the pinned, SRI-verified Lucide asset loaded from unpkg.
Progress and raw attempt events stay in IndexedDB on the current browser origin.

`npm test` runs Vitest in watch mode. Tests use offline fixtures and
fake-indexeddb; they do not call Wiktionary or OpenRouter.

## Dictionary builder

The dictionary targets Russian-recognizable vocabulary, up to the configured
maximum. Familiarity scores are curated or AI estimates, not learner-study results.
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

Configure sources, explicit priorities, learner languages, and the output ceiling in
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
`OPENROUTER_CONCURRENCY` controls parallel requests, defaults to 3, and accepts 1–10.
`ru` is the default enrichment language; adding languages is a configuration change.
The configured audience policy plans words **before** AI enrichment:

- `builder/data/recognizable-ru.json` pairs attested Armenian spellings with
  recognition hints and an optional `purpose` (`familiar` or `verification`).
  Hints are hypotheses, not guaranteed familiarity scores. Add reviewed
  concepts here to expand the vocabulary.
- Curated words are assessed first, followed by imported candidates in
  reviewed-list order, then the remaining Wiktionary vocabulary by source
  frequency and length. Missing reviewed spellings are reported, never invented.
  Enrichment stops once the output ceiling and audience-quality checks are satisfied.
  `selected-names.json` explicitly allows source-attested names through the
  otherwise name-excluding Wiktionary adapter.
- AI receives source definitions, parts of speech, and recognition hints. It
  checks current usage, meaning, recognizability, and beginner usefulness.
- Final composition follows the configured maximum, familiar-word minimum, and
  familiar-share requirement.
  Imported words need AI confidence >= 0.8; flagged words are excluded.
  Usefulness ranks familiar words. Verification words must be explicitly
  selected or curated, have familiarity <= 0.4, and imported verification
  words also need usefulness >= 0.5. Composition includes verification words
  only while the familiar share remains at least 70%.
- Every written Armenian letter must occur in at least two selected words.
  The CLI, `audience-report.json`, and GitHub release notes report coverage per
  letter; the JSON report also separates familiar and verification coverage.

`maxWords` is a ceiling, not a target to pad with arbitrary words. Quality-gate
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

Builder intermediates retain source URLs, licensing, definitions, per-field
metadata provenance, and AI version/model metadata. The minified runtime output
omits those build-only fields. The builder writes attribution beside its output
as an ignored local sidecar. The committed
`web/public/ATTRIBUTION.txt` is copied into every static deployment. Licensing
references and the changes to imported material are recorded there.

## License

The application source code is available under the MIT License; see
[`LICENSE.md`](LICENSE.md).

The bundled seed vocabulary is project-owned curated data. Dictionaries rebuilt
with Wiktionary records include adapted material under Creative Commons
Attribution-ShareAlike 4.0 where indicated. See
[`web/public/ATTRIBUTION.txt`](web/public/ATTRIBUTION.txt) for source credits,
licensing references, and a description of the dataset changes.
