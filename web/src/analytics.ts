const doNotTrackValues = new Set(['1', 'yes']);
let injected = false;

export function doNotTrackEnabled(value = navigator.doNotTrack) {
  return doNotTrackValues.has(value?.toLowerCase() ?? '');
}

export function startAnalytics(enabled: boolean) {
  if (!enabled || doNotTrackEnabled() || injected || !import.meta.env.PROD)
    return;
  injected = true;
  void import('@vercel/analytics').then(({ inject }) => inject());
}
