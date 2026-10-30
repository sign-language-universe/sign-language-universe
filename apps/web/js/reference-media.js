/* Shared public reference-video manifest for learning, challenge, and scoring UI. */
(function () {
  const state = { entries: {}, ready: null };
  state.ready = fetch('assets/content/reference_media_manifest.json', { cache: 'no-cache' })
    .then((response) => response.ok ? response.json() : { entries: [] })
    .then((payload) => {
      (payload.entries || []).forEach((entry) => {
        if (!entry || entry.word_index == null || !entry.path || entry.review_status !== 'manually_approved' || entry.public_release !== true) return;
        state.entries[String(entry.word_index)] = {
          ...entry,
          semantic_overlay_path: entry.semantic_overlay_status === 'manually_approved' ? entry.semantic_overlay_path : ''
        };
      });
      return state.entries;
    })
    .catch(() => state.entries);
  window.SLUReferenceMedia = {
    ready: state.ready,
    getByIndex: (index) => state.entries[String(index)] || null,
    getByWord: (word) => Object.values(state.entries).find((entry) => entry.word_zh === word || entry.word_en === word) || null
  };
})();
