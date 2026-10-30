const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../apps/web/js/interactive-learning.js'), 'utf8');
const fn = source.slice(source.indexOf('  function handleInteractiveScore(item, result)'), source.indexOf('  function renderStageScores(result)'));
function run(result) {
  const icon = {}, status = {}, panel = {style: {}, classList: {toggle() {}}};
  const root = {querySelector: selector => ({'#result-icon': icon, '#challenge-result': panel}[selector] || null)};
  const context = {result, state: {locale:'zh', teacherHistory:[], teacherHistoryIndex:1}, TeacherAgent:{scoreFeedback:()=>({text:'feedback'})}, document:{getElementById:id=>id==='interactive-score-host'?root:id==='interactive-score-state'?status:null}, renderGroupAdvice(){}, renderGroupScores(){}, renderTreeScore(){}, renderReviewButton(){}, t:key=>key};
  vm.createContext(context);
  vm.runInContext(fn+';handleInteractiveScore({index:1},result)', context);
  return {icon:icon.textContent,status:status.textContent};
}
test('valid high semantic scores retain the celebration icon without inventing a pass threshold', () => {
  const result=run({score:87,score_valid:true,diagnostics:{scoring_mode:'cascade'}});
  assert.equal(result.icon,'🎉');
  assert.match(result.status,/不用于判断是否达标/);
  assert.equal(run({score:79,score_valid:true}).icon,'🔄');
});
test('invalid, missing, fallback and capture-quality scores never celebrate', () => {
  for(const result of [{score:87,score_valid:false},{score:null,score_valid:true},{score:87,score_valid:true,level:'fallback'},{score:87,score_valid:true,level:'capture_quality'}]) assert.equal(run(result).icon,'🔄');
});
