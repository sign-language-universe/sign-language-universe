const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '../apps/web');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/teacher-agent.js'), 'utf8'), context);
const teacher = context.window.TeacherAgent;
const bus = JSON.parse(fs.readFileSync(path.join(root, 'assets/content/interactive_learning_contracts.json'), 'utf8')).contracts.find(item => item.en === 'Bus');
const groupAdvice = [bus.ordered_sequence[0], bus.ordered_sequence[2]].map(stage => ({
  group: stage.label_zh, group_label: stage.label_zh, group_score: 50,
  related_stage_label_zh: stage.label_zh, related_stage_label_en: stage.label_en,
  related_stage_detail_zh: stage.detail_zh, related_stage_detail_en: stage.detail_en
}));
const result = {score_valid: true, score: 50, diagnostics: {group_advice: groupAdvice}};

test('Bus feedback uses English stage labels with English descriptions', () => {
  const text = teacher.scoreFeedback(result, bus, 'en').text;
  assert.match(text, /Grip a bus strap/);
  assert.match(text, /Rock forward and back — second time/);
  assert.match(text, /Establish the hand-grip posture/);
  assert.doesNotMatch(text, /[\u3400-\u9fff]/);
});

test('Bus feedback uses Chinese labels and descriptions in Chinese UI', () => {
  const text = teacher.scoreFeedback(result, bus, 'zh').text;
  assert.match(text, /虚握公交车把手/);
  assert.match(text, /前后晃动第2次/);
  assert.doesNotMatch(text, /Grip a bus strap|Establish the hand-grip/);
});

test('integrated group and stage advice respects the active UI language', () => {
  const source = fs.readFileSync(path.join(root, 'js/interactive-learning.js'), 'utf8');
  const fn = source.slice(source.indexOf('  function renderGroupAdvice(result)'), source.indexOf('  function collectSample('));
  for (const locale of ['en', 'zh']) {
    const host = {};
    const ctx = {state: {locale}, document: {getElementById: () => host}, esc: String};
    vm.createContext(ctx);
    vm.runInContext(fn, ctx);
    ctx.payload = {...result, diagnostics: {...result.diagnostics, stage_advice: [{stage_label: '中文默认标签', stage_label_en: 'Second rock', stage_label_zh: '第二次晃动', suggestion: '中文默认建议', suggestion_en: 'Rock twice.', suggestion_zh: '晃动两次。'}]}};
    vm.runInContext('renderGroupAdvice(payload)', ctx);
    if (locale === 'en') {
      assert.match(host.innerHTML, /Grip a bus strap/);
      assert.match(host.innerHTML, /Second rock/);
      assert.doesNotMatch(host.innerHTML, /[\u3400-\u9fff]/);
    } else {
      assert.match(host.innerHTML, /虚握公交车把手/);
      assert.match(host.innerHTML, /第二次晃动/);
      assert.doesNotMatch(host.innerHTML, /Grip a bus strap|Rock twice/);
    }
  }
});
