# Umami milestone analytics

Completed. Production builds use consent-gated Umami analytics; development builds log the same events to the console. The Umami website ID is provided through `VITE_UMAMI_WEBSITE_ID` at build time. Vercel Analytics was removed.

## Behaviour

- [x] Load Umami only after the learner explicitly enables anonymous analytics in production. In development, use console logging with the same opt-in and Do Not Track checks.
- [x] Never load or send analytics when browser Do Not Track is enabled.
- [x] Send one manual page view per app visit; disable Umami's automatic page views and click tracking.
- [x] Count submitted, non-skipped answers since analytics starts for the current app visit. Emit `practice_session_milestone` once per visit at `1`, `5`, `10`, `25`, and `50`. Prior local history and answers submitted before opt-in do not trigger events. Send only the `milestone` property; correctness does not matter.
- [x] On each app visit, emit the property-free `practice_returned` event once if local history already contains at least one submitted, non-skipped answer.
- [x] Never send answers, Armenian words, correctness, raw attempts, progress records, settings, identifiers, or free-text properties.
- [x] Update the privacy page and settings copy.

These events show visits that start practice, reach deeper per-visit milestones, and return after earlier practice. They count engaged and returning visits, not distinct learners or day-based retention; measuring those would require linking visits with an identifier.

## Done when

- [x] Umami can distinguish a page view, first answer, and deeper per-visit milestones, plus visits with prior local practice history.
- [x] Opting out prevents later Umami loads and sends.
- [x] Do Not Track prevents all Umami loads and sends.
