import type { Report, StageProgress } from './types.ts';

const duration = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, '0')}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, '0')}`;
export function formatProgress(p: StageProgress, elapsed: number): string {
  const progress =
    p.total === undefined
      ? `${p.processed}`
      : `${p.processed}/${p.total} ${p.total ? ((p.processed / p.total) * 100).toFixed(1) : '100.0'}%`;
  const newWork = p.processed - (p.cached ?? 0);
  const eta =
    p.total && newWork > 0 && elapsed >= 1000
      ? duration((elapsed / newWork) * Math.max(0, p.total - p.processed))
      : '—';
  return `[${p.stage}] ${progress}${p.batch === undefined ? '' : ` | batch ${p.batch}/${p.batches}`} | cached ${p.cached ?? 0} | API ${p.api ?? 0} | rejected ${p.rejected ?? 0} | failed ${p.failures ?? 0} | retries ${p.retries ?? 0} | elapsed ${duration(elapsed)} | ETA ${eta}`;
}
export function createReporter(quiet: boolean, verbose: boolean): Report {
  const started = new Map<string, number>();
  let last = 0,
    lastStatus = '';
  return (progress) => {
    if (quiet) return;
    const now = Date.now();
    const startedAt = started.get(progress.stage) ?? now;
    started.set(progress.stage, startedAt);
    const final =
      progress.processed === progress.total || progress.detail === 'complete';
    const status = [
      progress.stage,
      progress.batch,
      progress.failures,
      progress.retries,
    ].join(':');
    if (!verbose && !final && status === lastStatus && now - last < 500) return;
    lastStatus = status;
    const text = formatProgress(progress, now - startedAt);
    const detail = verbose && progress.detail ? ` | ${progress.detail}` : '';
    process.stdout.write(
      `${process.stdout.isTTY && !verbose ? '\r\u001b[2K' : ''}${text}${detail}${final || verbose || !process.stdout.isTTY ? '\n' : ''}`,
    );
    last = now;
  };
}
