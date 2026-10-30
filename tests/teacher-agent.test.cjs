const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../apps/web/js/teacher-agent.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'teacher-agent.js' });
const teacher = context.window.TeacherAgent;

const item = {
  summary_zh: '中文词义', summary_en: 'English meaning',
  ordered_sequence: [{ detail_zh: '先抬手', detail_en: 'Raise hand first' }],
  simultaneous_features: [{ label_zh: '手形', label_en: 'Handshape', features_zh: ['张开'], features_en: ['Open'] }]
};

test('semantic group advice maps to concise coach guidance', () => {
  const result = teacher.scoreFeedback({ score_valid: true, score: 73, diagnostics: { scoring_mode: 'cascade', group_focus: ['left_hand_shape'], group_scores: { left_hand_shape: 61 }, group_weak: { left_hand_shape: true }, group_advice: [{ group: 'left_hand_shape', group_score: 61, suggestion: '对照该词指导练习手形。' }] } }, item, 'zh');
  assert.match(result.text, /我们再把「左手手形」单独练一遍/);
  assert.match(result.text, /对照该词指导练习手形/);
  assert.doesNotMatch(result.text, /整体得分|61分|73 分|89 分/);
});

test('unknown group advice does not suppress known advice or weak-group fallback', () => {
  const result = teacher.scoreFeedback({ score_valid: true, score: 70, diagnostics: { group_focus: ['left_hand_shape'], group_scores: { left_hand_shape: 61 }, group_weak: { left_hand_shape: true }, group_advice: [{ group: 'future_group' }, { group: 'left_hand_shape', group_score: 61, suggestion: '对照该词指导练习手形。' }] } }, item, 'zh');
  assert.match(result.text, /对照该词指导练习手形/);
  assert.doesNotMatch(result.text, /future_group/);
});

test('missing semantic groups are not inferred from the overall score', () => {
  const result = teacher.scoreFeedback({ score_valid: true, score: 49, diagnostics: { group_focus: ['left_hand_shape','face'], group_scores: { left_hand_shape: null, face: null }, group_weak: { left_hand_shape: false, face: false } } }, item, 'zh');
  assert.match(result.text, /你已经在进步啦/);
  assert.doesNotMatch(result.text, /手形（|面部特征（|整体得分/);
});

test('low total with available non-weak focus groups is not described as an error', () => {
  const result = teacher.scoreFeedback({ score_valid: true, score: 79, diagnostics: { group_focus: ['left_hand_shape'], group_scores: { left_hand_shape: 84 }, group_weak: { left_hand_shape: false } } }, item, 'zh');
  assert.match(result.text, /做得真棒/);
  assert.doesNotMatch(result.text, /做偏了|动作错误|整体得分/);
});

test('invalid result never judges movement or uses pass threshold', () => {
  const text = teacher.scoreFeedback({ score_valid: false, score: 98, diagnostics: {} }, item, 'en').text;
  assert.match(text, /marked invalid/);
  assert.doesNotMatch(text, /reached the current threshold|98 points/);
});

test('fallback and capture-quality scores are explicitly not similarity scores', () => {
  assert.match(teacher.scoreFeedback({ score_valid: true, score: 90, diagnostics: { scoring_mode: 'browser_frame_fallback' } }, item, 'en').text, /not template similarity/);
  assert.match(teacher.scoreFeedback({ score_valid: true, score: 90, diagnostics: { scoring_mode: 'web_holistic_capture_quality' } }, item, 'zh').text, /采集质量分/);
});

test('bilingual answers honor locale and fall back to the other language', () => {
  assert.match(teacher.answer(item, 'meaning', 'en').text, /English meaning/);
  assert.match(teacher.answer(item, 'order', 'zh').text, /先抬手/);
  assert.match(teacher.answer({ summary_zh: '仅中文' }, 'meaning', 'en').text, /仅中文/);
  assert.equal(teacher.classify('What is the movement order?', 'en'), 'order');
  assert.equal(teacher.classify('动作顺序是什么', 'zh'), 'order');
});

test('unknown questions offer supported choices rather than fabricated answers', () => {
  const result = teacher.answer(item, 'unknown', 'en');
  assert.match(result.text, /Choose one of these topics/);
  assert.equal(result.action, undefined);
});

test('stage-only advice uses the returned stage label and suggestion', () => {
  const result = teacher.scoreFeedback({ score_valid:true, diagnostics:{stage_advice:[{stage_index:1,stage_label:'起始位',suggestion:'先对准起始位置。'}]} },item,'zh');
  assert.match(result.text,/起始位/);
  assert.match(result.text,/先对准起始位置/);
  assert.doesNotMatch(result.text,/我已经结合本次可用的核心语义局部评分看过了/);
});

test('null score is not rendered as zero and does not infer specific errors', () => {
  const result = teacher.scoreFeedback({score_valid:true,score:null,diagnostics:{}},item,'zh');
  assert.doesNotMatch(result.text,/0 分|整体得分是 0/);
  assert.match(result.text,/不会从总分猜测具体问题/);
});

test('group advice selects localized stage detail for each UI language', () => {
  const payload = {score_valid:true,score:72,diagnostics:{group_advice:[{group:'left_hand_shape',group_score:60,group_label:'Left hand shape',group_label_zh:'左手手形',suggestion:'Generic suggestion',related_stage_detail_zh:'核对左手手形。',related_stage_detail_en:'Check left-hand shape.'}]}};
  assert.match(teacher.scoreFeedback(payload,item,'zh').text,/左手手形/);
  assert.match(teacher.scoreFeedback(payload,item,'en').text,/Check left-hand shape/);
  assert.doesNotMatch(teacher.scoreFeedback(payload,item,'en').text,/Generic suggestion/);
});

test('returned scoring feedback is retained with local semantic advice', () => {
  const result = teacher.scoreFeedback({score_valid:true,score:68,feedback:[{message:'请让双手完整入画。'}],diagnostics:{group_advice:[{group:'left_hand_shape',group_score:55,suggestion:'对照指导核对手形。'}]}},item,'zh');
  assert.match(result.text,/左手手形/);
  assert.match(result.text,/请让双手完整入画/);
});

test('the coach offers only three concise preset questions', () => {
  const source = fs.readFileSync(path.join(__dirname, '../apps/web/js/teacher-agent.js'), 'utf8');
  assert.match(source,/const questions=\[\['meaning',c\.askMeaning\],\['order',c\.askOrder\],\['score',c\.askScore\]\]/);
  assert.doesNotMatch(source,/data-teacher-avatar/);
});

test('score intent and invalid or threshold-less results do not infer score emotion', () => {
  const source = fs.readFileSync(path.join(__dirname, '../apps/web/js/teacher-agent.js'), 'utf8');
  assert.match(source,/const validJudgment=result\?\.score_valid === true && Number\.isFinite\(score\) && Number\.isFinite\(threshold\)/);
  assert.match(source,/const avatarState=validJudgment \? \(score >= threshold \? 'happy' : 'thinking'\) : 'idle'/);
  assert.doesNotMatch(source,/if\(id==='score' && options\.result\)/);
  assert.match(teacher.answer(item, 'score', 'zh').text, /语义动作头/);
});

test('coach feedback gives actionable advice instead of a score report', () => {
  const result=teacher.scoreFeedback({score_valid:true,score:48,diagnostics:{scoring_mode:'cascade',group_focus:['right_hand_motion'],group_scores:{right_hand_motion:47},group_weak:{right_hand_motion:true},group_advice:[{group:'right_hand_motion',group_label:'Reach right — first time',suggestion:'Reach toward an item on the right.'}]}},item,'en');
  assert.match(result.text,/Let’s give Reach right — first time one more focused try/);
  assert.match(result.text,/Reach toward an item on the right/);
  assert.doesNotMatch(result.text,/overall score|47\/100|Your overall score/);
});

test('coach praises a pass only when an explicit threshold is present', () => {
  const payload={score_valid:true,score:84,pass_threshold:80,diagnostics:{group_focus:['left_hand_shape'],group_scores:{left_hand_shape:88},group_weak:{left_hand_shape:false}}};
  assert.match(teacher.scoreFeedback(payload,item,'en').text,/Wonderful job/);
  assert.doesNotMatch(teacher.scoreFeedback({...payload,pass_threshold:undefined},item,'en').text,/Wonderful job/);
});

test('threshold-less weak-group feedback stays encouraging without declaring pass or fail', () => {
  const text=teacher.scoreFeedback({score_valid:true,score:48,diagnostics:{group_focus:['left_hand_shape'],group_scores:{left_hand_shape:42},group_weak:{left_hand_shape:true}}},item,'zh').text;
  assert.match(text,/先暂停在指导对应的关键帧/);
  assert.doesNotMatch(text,/达到目标|未达到|整体得分/);
});

function test(name, fn) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1; }
}
