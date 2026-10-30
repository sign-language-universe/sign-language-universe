const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const root = path.join(__dirname, '../apps/web');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/content/reference_media_manifest.json'), 'utf8'));

test('release manifest keeps Jump unavailable while preserving approved words', async () => {
  const jump = manifest.entries.find(entry => entry.word_index === 17);
  assert.ok(jump);
  assert.equal(jump.path, '');
  assert.equal(jump.semantic_overlay_path, '');
  assert.equal(jump.review_status, 'removed');
  const context = {window:{}, fetch:async()=>({ok:true,json:async()=>manifest})};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/reference-media.js'), 'utf8'),context);
  await context.window.SLUReferenceMedia.ready;
  assert.equal(context.window.SLUReferenceMedia.getByIndex(17),null);
  assert.ok(context.window.SLUReferenceMedia.getByIndex(3));
  assert.ok(context.window.SLUReferenceMedia.getByIndex(5));
});

test('interactive word list excludes Jump using the release manifest', () => {
  const contracts = JSON.parse(fs.readFileSync(path.join(root,'assets/content/interactive_learning_contracts.json'),'utf8')).contracts;
  const media = Object.fromEntries(manifest.entries.filter(entry=>entry.path).map(entry=>[String(entry.word_index),entry]));
  const displayed = contracts.filter(item=>Boolean(media[String(item.index)]));
  assert.ok(displayed.length>0);
  assert.equal(displayed.some(item=>item.index===17 || item.zh==='跳'),false);
  assert.ok(displayed.some(item=>item.zh==='超市'));
});
