const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(locale, result) {
  const log = {children: [], appendChild(node) { this.children.push(node); }, querySelector() { return null; }};
  const form = {addEventListener(name, fn) { this[name] = fn; }};
  const labels = locale === 'en' ? ['What does this sign mean?', 'How do I do the movement?', 'How should I read my score?'] : ['词汇是什么意思？', '动作顺序怎么做？', '评分结果怎么看？'];
  const buttons = ['meaning', 'order', 'score'].map((id, index) => ({dataset: {intent: id}, textContent: labels[index], addEventListener(name, fn) { this[name] = fn; }}));
  const container = {querySelector: selector => selector === '[data-log]' ? log : form, querySelectorAll: selector => selector === '[data-intent]' ? buttons : [], addEventListener() {}};
  const context = {window: {}, document: {createElement: () => ({dataset: {}})}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../apps/web/js/teacher-agent.js'), 'utf8'), context);
  const item = {summary_zh: '乘坐公交车。', summary_en: 'Ride a bus.', ordered_sequence: [{label_zh: '虚握公交车把手', label_en: 'Grip a bus strap'}]};
  const ui = context.window.TeacherAgent.render(container, {locale, item, result});
  return {ui, buttons, form, log};
}

test('proactive welcome, capture notifications and score feedback differ from interactive replies', () => {
  const f = setup('zh');
  assert.match(f.log.children[0].className, /teacher-bubble-proactive/);
  f.ui.notify('已经开始采集了。');
  assert.match(f.log.children.at(-1).className, /teacher-bubble-proactive/);
  assert.equal(f.ui.history.at(-1).proactive, true);
  f.buttons[0].click();
  assert.doesNotMatch(f.log.children.at(-1).className, /teacher-bubble-proactive/);
  f.ui.replaceScoreFeedback({score_valid:false});
  assert.match(f.log.children.at(-1).className, /teacher-bubble-proactive/);
});

test('preset questions append one right-aligned learner message before the coach answer', () => {
  for (const locale of ['zh', 'en']) {
    const f = setup(locale);
    f.buttons[0].click();
    const messages = f.ui.history.slice(-2);
    assert.equal(messages[0].who, 'learner');
    assert.equal(messages[0].text, f.buttons[0].textContent);
    assert.equal(messages[1].who, 'coach');
    assert.equal(f.log.children.at(-2).className, 'teacher-bubble teacher-bubble-learner');
  }
});

test('score preset explains semantic heads even when a scoring result exists', () => {
  for (const locale of ['zh', 'en']) {
    const f = setup(locale, {score_valid: false, score: 95});
    f.buttons[2].click();
    const messages = f.ui.history.slice(-2);
    assert.equal(messages[0].who, 'learner');
    assert.equal(messages[1].who, 'coach');
    assert.match(messages[1].text, locale === 'en' ? /semantic action heads/ : /语义动作头/);
    assert.match(messages[1].text, locale === 'en' ? /not simply the average/ : /不是把各项动作分数简单取平均/);
    if (locale === 'en') assert.doesNotMatch(messages[1].text, /[\u3400-\u9fff]/);
  }
});

test('typed score questions produce exactly one learner message and the same mechanism explanation', () => {
  const f = setup('zh');
  const question = {value: '评分结果怎么看？'};
  const before = f.ui.history.length;
  f.form.submit({preventDefault() {}, currentTarget: {elements: {question}}});
  assert.equal(f.ui.history.length, before + 2);
  assert.equal(f.ui.history.at(-2).who, 'learner');
  assert.match(f.ui.history.at(-1).text, /语义动作头/);
  assert.equal(question.value, '');
});
