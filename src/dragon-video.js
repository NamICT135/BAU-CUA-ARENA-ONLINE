/** Visibility-owned playback: small VP9 loop, MP4 fallback, then still poster. */
export function createDragonPlayback(video) {
  if (!video) return { setVisible() {}, cleanup() {} };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // This card is itself an animation deliverable. The explicit markup flag lets
  // it keep playing while the rest of the decorative lobby motion stays reduced.
  const forceMotion = video.dataset.forceMotion === 'true';
  const requestedRate = Number(video.dataset.playbackRate);
  const playbackRate = Number.isFinite(requestedRate) && requestedRate > 0 ? requestedRate : 1;
  let visible = false;
  let intersecting = !window.IntersectionObserver;
  let failed = false;
  let disposed = false;
  const candidates = [
    video.dataset.webm && video.canPlayType('video/webm; codecs="vp9"') ? video.dataset.webm : null,
    video.dataset.src,
  ].filter(Boolean);
  let candidateIndex = 0;
  const shouldPlay = () => !disposed && !failed && visible && intersecting && !document.hidden &&
    (forceMotion || !reducedMotion.matches);

  function sync() {
    if (!shouldPlay()) {
      video.pause();
      return;
    }
    if (!video.getAttribute('src')) {
      if (!candidates[candidateIndex]) return onError();
      video.src = candidates[candidateIndex];
    }
    video.muted = true;
    video.defaultPlaybackRate = playbackRate;
    video.playbackRate = playbackRate;
    video.play()?.then(() => {
      // A pending play may finish after the user has already left the lobby.
      if (!shouldPlay()) video.pause();
    }).catch(() => { /* Poster remains available if autoplay is denied. */ });
  }

  function onError() {
    if (disposed) return;
    if (candidateIndex + 1 < candidates.length) {
      candidateIndex += 1;
      // Clear the failed source, but defer the fallback download if hidden.
      video.removeAttribute('src');
      video.load();
      sync();
      return;
    }
    failed = true;
    video.pause();
    video.hidden = true;
  }

  const observer = window.IntersectionObserver ? new IntersectionObserver(([entry]) => {
    intersecting = entry.isIntersecting;
    sync();
  }, { threshold: 0.01 }) : null;
  observer?.observe(video);
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', sync);
  video.addEventListener('error', onError);

  return {
    setVisible(value) { visible = value; sync(); },
    cleanup() {
      disposed = true;
      video.pause();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reducedMotion.removeEventListener('change', sync);
      video.removeEventListener('error', onError);
    },
  };
}
