---
name: curated-dictionary-words
description: Add useful Armenian entries to the project's curated vocabulary JSON packs when asked to expand or edit a curated dictionary.
---

# Adding curated Armenian words

Use this skill when the user asks to add or revise words in `builder/data/curated-*.json`. Follow their requested pack, theme, and any explicit inclusion or exclusion rules.

- Inspect the target pack, its builder config, repository instructions, and nearby entries before editing. Match the file's ordering and metadata conventions.
- Choose useful Armenian lemmas from your language knowledge. Prefer words whose spelling, sense, and target-language translation are clear; skip uncertain candidates instead of padding a list. Check a dictionary only when an uncertainty could change the entry.
- Store the Armenian headword in canonical uppercase Armenian. Each entry must be one word, with no spaces or multiword phrases. In particular, keep country names to single words.
- Check for duplicates and existing spelling variants in the target pack. Use concise meanings, normally Russian for these packs, and keep numeric scores within the repository's 0–1 range when the neighboring entries use them.
- Reuse valid categories and existing tags. Do not invent tags, change the tag whitelist or translations, or add tags unless the user asks for tagging.
- Curated packs can include all their entries without a fixed `maxWords` cap. Do not reintroduce a cap just to accommodate additions.
- Validate the edited JSON with `jq`, then run the affected curated build or the narrowest relevant tests. Avoid regenerating or committing generated dictionary assets unless requested.
