import { version as appVersion } from '../../../package.json';
import type { Dictionary } from '../../../shared/types.ts';
import { TRAINER_CONFIG } from '../core/config.ts';
import { progress } from '../core/session.ts';
import { t } from '../i18n/index.ts';
import { PROGRESS_SCHEMA_VERSION } from '../storage/repository.ts';
import type { Trainer } from '../trainer.ts';

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const json = (value: unknown) =>
  JSON.stringify(
    value,
    (_key, item) =>
      typeof item === 'number' && !Number.isInteger(item)
        ? Number(item.toFixed(4))
        : item,
    2,
  );

async function storageDiagnostics() {
  if (!navigator.storage) return { available: false };
  const [estimate, persisted] = await Promise.all([
    navigator.storage.estimate().catch((): StorageEstimate => ({})),
    navigator.storage.persisted().catch(() => undefined),
  ]);
  return {
    available: true,
    usageBytes: estimate.usage,
    quotaBytes: estimate.quota,
    persisted,
  };
}

function section(title: string, value: unknown, collapsed = false) {
  const container = document.createElement('section');
  container.className = 'debug-section';
  const heading = document.createElement('div');
  heading.className = 'debug-section-heading';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  const copy = document.createElement('button');
  copy.className = 'debug-copy';
  copy.type = 'button';
  copy.title = t('debug.copy');
  copy.setAttribute('aria-label', t('debug.copy'));
  const status = document.createElement('span');
  status.className = 'debug-copy-status';
  status.setAttribute('role', 'status');
  const output = document.createElement('pre');
  output.textContent = json(value);
  const code = document.createElement('div');
  code.className = 'debug-code';
  code.append(output, status, copy);
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.textContent);
      status.textContent = t('debug.copied');
    } catch {
      status.textContent = t('debug.failed');
    }
    window.setTimeout(() => {
      status.textContent = '';
    }, 1500);
  });
  heading.append(h3);
  if (collapsed) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = t('debug.showJson');
    details.append(summary, code);
    container.append(heading, details);
  } else container.append(heading, code);
  return container;
}

export function mountDebugDialog(trainer: Trainer, dictionary: Dictionary) {
  const dialog = element<HTMLDialogElement>('debug-dialog');
  const content = element('debug-content');

  element('debug-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  return async () => {
    const state = trainer.state;
    const attempt = state.recent[0];
    const stats = progress(state);
    const skipped = state.recent.filter(
      (item) => item.payload.evaluation.status === 'unknown',
    ).length;
    const incorrect = state.recent.filter(
      (item) =>
        !item.payload.correct && item.payload.evaluation.status !== 'unknown',
    ).length;
    const snapshot = {
      selection: {
        wordId: trainer.current.word.id,
        word: trainer.current.word.word,
        phase: trainer.current.phase,
        introducedLetter: trainer.current.introducedLetter,
        unknownLetters: trainer.current.diagnostics?.unknownLetters,
        diagnostics: trainer.current.diagnostics,
      },
      currentWord: trainer.current.word,
      lastEvaluation: attempt
        ? {
            wordId: attempt.payload.wordId,
            answer: attempt.payload.answer,
            durationMs: attempt.payload.answeredAt - attempt.payload.shownAt,
            ...attempt.payload.evaluation,
          }
        : null,
      scoreUpdate: trainer.lastScoreUpdate ?? null,
      learner: {
        attempts: state.recent.length,
        correct: state.recent.filter((item) => item.payload.correct).length,
        incorrect,
        skipped,
        uniqueWordsSeen: Object.keys(state.words).length,
        verifiedLetters: Object.values(state.letters).filter(
          (letter) => letter.verified > 0,
        ).length,
        reinforcement: state.reinforcement,
        progress: stats,
        weakestLetters: Object.entries(state.letters)
          .sort((a, b) => a[1].score - b[1].score)
          .slice(0, 10)
          .map(([letter, stat]) => ({ letter, ...stat })),
      },
      presentation: {
        font: trainer.font,
        typography: trainer.presentation,
        settings: trainer.settings,
      },
      runtime: {
        appVersion,
        dictionary: {
          version: dictionary.version,
          schemaVersion: dictionary.schemaVersion,
          generatedAt: dictionary.generatedAt,
          words: dictionary.words.length,
        },
        progressSchemaVersion: PROGRESS_SCHEMA_VERSION,
        config: TRAINER_CONFIG,
        language: navigator.language,
        online: navigator.onLine,
        viewport: `${window.innerWidth}×${window.innerHeight}`,
        storage: await storageDiagnostics(),
      },
    };
    content.replaceChildren(
      section(t('debug.selection'), snapshot.selection),
      section(t('debug.currentWord'), snapshot.currentWord),
      section(t('debug.lastEvaluation'), snapshot.lastEvaluation),
      section(t('debug.scoreUpdate'), snapshot.scoreUpdate),
      section(t('debug.learner'), snapshot.learner),
      section(t('debug.presentation'), snapshot.presentation),
      section(t('debug.runtime'), snapshot.runtime),
      section(t('debug.rawSelection'), trainer.current, true),
      section(t('debug.rawAttempt'), attempt ?? null, true),
      section(t('debug.rawState'), state, true),
    );
    dialog.showModal();
  };
}
