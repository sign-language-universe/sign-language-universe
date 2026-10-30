const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../apps/web/js/reference-media.js', `file://${__filename}`), 'utf8');

test('reference media exposes only released and reviewed videos and overlays', async () => {
  const manifest = { entries: [
    { word_index: 1, path: 'approved.mp4', review_status: 'manually_approved', public_release: true,
      semantic_overlay_path: 'approved-overlay.mp4', semantic_overlay_status: 'manually_approved' },
    { word_index: 2, path: 'unreleased.mp4', review_status: 'manually_approved', public_release: false },
    { word_index: 3, path: 'pending.mp4', review_status: 'pending_user_review', public_release: true },
    { word_index: 4, path: 'approved-original.mp4', review_status: 'manually_approved', public_release: true,
      semantic_overlay_path: 'pending-overlay.mp4', semantic_overlay_status: 'pending_user_review' }
  ] };
  const context = {
    fetch: async () => ({ ok: true, json: async () => manifest }),
    window: {}
  };
  vm.runInNewContext(source, context);
  await context.window.SLUReferenceMedia.ready;
  assert.equal(context.window.SLUReferenceMedia.getByIndex(1).path, 'approved.mp4');
  assert.equal(context.window.SLUReferenceMedia.getByIndex(1).semantic_overlay_path, 'approved-overlay.mp4');
  assert.equal(context.window.SLUReferenceMedia.getByIndex(2), null);
  assert.equal(context.window.SLUReferenceMedia.getByIndex(3), null);
  assert.equal(context.window.SLUReferenceMedia.getByIndex(4).path, 'approved-original.mp4');
  assert.equal(context.window.SLUReferenceMedia.getByIndex(4).semantic_overlay_path, '');
});
