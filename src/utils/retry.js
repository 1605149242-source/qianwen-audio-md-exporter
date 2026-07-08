export function ensureRetryState(state) {
  state.uploadAttemptsV2 ||= {};
  state.failedRerunsV1 ||= {};
  return state;
}

export function getAttempt(state, title) {
  const value = state.uploadAttemptsV2?.[title];
  return {
    count: Number(value?.count || 0),
    lastAttemptAt: Number(value?.lastAttemptAt || 0),
    forceUpload: Boolean(value?.forceUpload)
  };
}

export function getFailedRerunCount(state, title) {
  return Number(state.failedRerunsV1?.[title]?.count || 0);
}

export function hasReachedFinalFailure(state, title, config) {
  return getAttempt(state, title).count >= config.maxRetries
    && getFailedRerunCount(state, title) >= config.failedRerunLimit;
}

export function canStartFailedRerun(state, title, config) {
  return getAttempt(state, title).count >= config.maxRetries
    && getFailedRerunCount(state, title) < config.failedRerunLimit;
}

export function titlesReadyForFailedRerun(state, titles, config) {
  if (titles.length === 0) return [];
  const eligible = titles.filter((title) => canStartFailedRerun(state, title, config));
  return eligible.length === titles.length ? eligible : [];
}

export function startFailedRerun(state, titles, now = Date.now()) {
  ensureRetryState(state);
  for (const title of titles) {
    const attempt = getAttempt(state, title);
    const rerun = state.failedRerunsV1[title] || {};
    state.failedRerunsV1[title] = {
      count: Number(rerun.count || 0) + 1,
      lastRerunAt: now,
      previousAttemptCount: attempt.count
    };
    state.uploadAttemptsV2[title] = {
      count: 0,
      lastAttemptAt: 0,
      forceUpload: true,
      resetAt: now
    };
  }
  return titles.length;
}
