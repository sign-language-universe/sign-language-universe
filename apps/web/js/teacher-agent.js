/* Local, deterministic teaching assistant for the public interactive lab. */
(function (global) {
  'use strict';
  const copy = {
    zh: {title:'小语老师', role:'你的手语练习伙伴', hello:'你好！我会陪你拆解动作、对照示范，再按评分里真实出现的信息一起复盘。', meaning:'这个词的语义提示', order:'动作按这个顺序来', features:'同一时刻留意', watch:'我们先看参考内容，再回到动作指导逐步练。', practice:'准备好后，点页面里的“开始摄像头评分”；摄像头不会由老师自动开启。', score:'本次结果', invalid:'这次评分标记为无效，我先不判断动作好坏。', fallback:'这是回退/预览分，不代表与标准动作的相似度。', quality:'这是采集质量分，不代表动作与标准模板的相似度。', pass:'本次分数达到当前阈值。', low:'本次分数尚未达到当前阈值。', details:'目前没有可用的局部诊断；我不会从总分猜测具体问题。', encouragement:'我们对照指导，再选一个小目标练习。', askMeaning:'词汇是什么意思？', askOrder:'动作顺序怎么做？', askScore:'评分结果怎么看？', close:'收起老师', motion:'微动效', input:'问老师一个问题', send:'发送', guidance:'看动作指导', reference:'看参考动画/视频'},
    en: {title:'Mia · Sign Coach', role:'Your practice companion', hello:'Hi! I can break down the sign, point you to the reference, and reflect only what the score actually reports.', meaning:'Meaning cue', order:'Try the movement in this order', features:'Notice these together', watch:'Let’s look at the reference, then practise with the action guidance.', practice:'When ready, choose “Start camera scoring” on the page. I will never turn on the camera automatically.', score:'Your result', invalid:'This result is marked invalid, so I will not judge the movement.', fallback:'This is a fallback/preview score, not template similarity.', quality:'This is a capture-quality score, not similarity to a standard sign.', pass:'This score reached the current threshold.', low:'This score did not reach the current threshold.', details:'No local diagnostics are available, so I will not guess which part needs work.', encouragement:'Let’s compare with the guidance and choose one small practice goal.', askMeaning:'What does this sign mean?', askOrder:'How do I do the movement?', askScore:'How should I read my score?', close:'Close coach', motion:'Motion', input:'Ask the coach', send:'Send', guidance:'Action guidance', reference:'Reference animation/video'}
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const lang = locale => locale === 'en' ? 'en' : 'zh';
  const localized = (item, zh, en, locale) => (locale === 'en' ? item?.[en] || item?.[zh] : item?.[zh] || item?.[en]) || '';
  function welcome(item, locale) {
    const L = lang(locale), c = copy[L];
    const first = item?.ordered_sequence?.[0];
    const step = first ? localized(first, 'detail_zh', 'detail_en', L) || localized(first, 'label_zh', 'label_en', L) : '';
    const key = L === 'en' ? 'Start with this key movement' : '先抓住这个关键动作';
    const routes = L === 'en' ? 'Open the action guidance or reference animation/video. Camera scoring starts only when you choose it.' : '可以打开动作 guidance 或参考动画/视频；只有你主动点击时才会开始摄像头评分。';
    return [c.hello, step ? `${key}：${step}` : '', routes].filter(Boolean).join('\n');
  }
  function answer(item, intent, locale) {
    const L = lang(locale), c = copy[L];
    if (!item) return {text:c.hello, action:null};
    if (intent === 'meaning') return {text:`${c.meaning}：${localized(item, 'summary_zh', 'summary_en', L)}`};
    if (intent === 'order') {
      const steps = (item.ordered_sequence || []).map((s,i) => `${i+1}. ${localized(s,'detail_zh','detail_en',L) || localized(s,'label_zh','label_en',L)}`).filter(Boolean);
      return {text: steps.length ? `${c.order}：\n${steps.join('\n')}` : c.hello};
    }
    if (intent === 'features') {
      const lines = (Array.isArray(item.simultaneous_features) ? item.simultaneous_features : []).map(f => {
        const values = L === 'en' ? (Array.isArray(f.features_en) ? f.features_en : f.features_zh) : (Array.isArray(f.features_zh) ? f.features_zh : f.features_en);
        return `${localized(f,'label_zh','label_en',L)}：${(Array.isArray(values) ? values : []).join('、')}`;
      }).filter(Boolean);
      return {text: lines.length ? `${c.features}：\n${lines.join('\n')}` : c.hello};
    }
    if (intent === 'score') {
      const stages = (item.ordered_sequence || []).map(stage => localized(stage, 'label_zh', 'label_en', L)).filter(Boolean);
      const examples = stages.length ? (L === 'en' ? ` For this sign, key semantic actions include: ${stages.join('; ')}.` : `例如这个词的关键语义动作包括：${stages.join('、')}。`) : '';
      return {text: L === 'en'
        ? `Our model uses semantic action heads to score how well each annotated key action of a sign is performed, rather than showing only one overall score.${examples} Read the individual action scores to see which parts match the target and which need more practice. The overall score is a separate model output, with a target-sign confidence gate; it is not simply the average of the action scores. These are model estimates, not an expert verdict. I can explain only the valid action scores and advice actually returned for your attempt.`
        : `我们的模型通过语义动作头，分别评估一个手语中各个已标注的关键语义动作完成得是否到位，而不只是给出一个总分。${examples}你可以查看各项动作分数，了解哪些关键动作更符合目标、哪些还需要针对性练习。综合分由独立的整体评分输出结合目标词置信度门控得到，不是把各项动作分数简单取平均。分数是模型的估计，不等同于专家结论；针对你这次练习，我只会依据实际返回且有效的分项分数和建议进行解释。`};
    }
    if (intent === 'watch') return {text:c.watch, action:'reference'};
    if (intent === 'practice') return {text:c.practice, action:'practice'};
    if (intent === 'unknown') return {text:L==='en'?'I can help with meaning, movement order, simultaneous features, reference material, and how to start practice. Choose one of these topics.':'我可以讲词义、动作顺序、同时特征、参考内容和如何开始练习。你可以从这些主题中选一个。'};
    return {text:c.hello};
  }
  const groupTeaching = {
    pose: {zh:'身体姿态',en:'body pose',tipZh:'先站稳并让躯干保持自然，再对照示范检查身体方向；不要为了追分刻意僵直。',tipEn:'Settle into a comfortable stance, then compare your body orientation with the reference; do not force a rigid pose.'},
    left_hand: {zh:'左手动作',en:'left-hand action',tipZh:'下一轮只关注左手：先对准指导中的起始位置，再完整做出这一侧动作。',tipEn:'For the next attempt, focus on the left hand: match its guided starting position, then complete that side of the movement.'},
    right_hand: {zh:'右手动作',en:'right-hand action',tipZh:'下一轮只关注右手：先对准指导中的起始位置，再完整做出这一侧动作。',tipEn:'For the next attempt, focus on the right hand: match its guided starting position, then complete that side of the movement.'},
    left_hand_shape: {zh:'左手手形',en:'left-hand shape',tipZh:'先暂停在指导对应的关键帧，对照左手手指形状；确认手形后再连起来做动作。',tipEn:'Pause at the matching guidance frame and compare the left-hand finger shape; confirm the shape before linking the motion.'},
    right_hand_shape: {zh:'右手手形',en:'right-hand shape',tipZh:'先暂停在指导对应的关键帧，对照右手手指形状；确认手形后再连起来做动作。',tipEn:'Pause at the matching guidance frame and compare the right-hand finger shape; confirm the shape before linking the motion.'},
    face: {zh:'面部特征',en:'facial features',tipZh:'对照词条指导留意已标注的面部特征；当前分数只说明这一评分组的匹配情况，不扩展推断未检测细节。',tipEn:'Use the word guidance to review the annotated facial feature. This score describes only this scored group; it does not imply unmeasured details.'},
    two_hand_relation: {zh:'双手配合',en:'two-hand coordination',tipZh:'放慢到能看清两只手的相对位置，再按指导确认主辅手关系后连贯完成。',tipEn:'Slow down enough to see both hands’ relative positions, confirm their roles against the guidance, then complete the sign smoothly.'},
    left_hand_motion: {zh:'左手动作过程',en:'left-hand motion',tipZh:'保持左手路径清楚、速度均匀；可分解练习起点到终点，再合并成完整动作。',tipEn:'Keep the left-hand path clear and even. Practise from start to finish in parts, then reconnect it into one movement.'},
    right_hand_motion: {zh:'右手动作过程',en:'right-hand motion',tipZh:'保持右手路径清楚、速度均匀；可分解练习起点到终点，再合并成完整动作。',tipEn:'Keep the right-hand path clear and even. Practise from start to finish in parts, then reconnect it into one movement.'},
    left_hand_shape_motion: {zh:'左手手形变化',en:'left-hand shape transition',tipZh:'先确认左手起始手形，再按示范完成手形变化；练习时把手形切换与移动分开观察。',tipEn:'Confirm the left-hand starting shape, then follow the demonstrated transition. Practise observing the shape change separately from travel.'},
    right_hand_shape_motion: {zh:'右手手形变化',en:'right-hand shape transition',tipZh:'先确认右手起始手形，再按示范完成手形变化；练习时把手形切换与移动分开观察。',tipEn:'Confirm the right-hand starting shape, then follow the demonstrated transition. Practise observing the shape change separately from travel.'},
    two_hand_relation_motion: {zh:'双手配合过程',en:'two-hand coordination over time',tipZh:'对照 guidance 分清两手如何同时或先后变化，再放慢练习这段配合过程。',tipEn:'Use the guidance to check how the hands change together or in sequence, then practise that coordination slowly.'}
  };
  function scoreFeedback(result, item, locale) {
    const L = lang(locale), c = copy[L], d = result?.diagnostics || {}, mode = String(d.scoring_mode || result?.level || '').toLowerCase();
    const rawScore = result?.score;
    const score = rawScore == null || rawScore === '' ? NaN : Number(rawScore);
    const fallback = mode.includes('fallback') || mode.includes('browser_frame_fallback');
    const captureQuality = mode.includes('capture_quality') || mode.includes('web_holistic_capture_quality');
    if (result?.score_valid !== true) return {text:c.invalid, advice:c.invalid, item};
    if (fallback) return {text:c.fallback, advice:c.fallback, item};
    if (captureQuality) return {text:c.quality, advice:c.quality, item};
    const weak = d.group_weak && typeof d.group_weak === 'object' ? d.group_weak : {};
    const scores = d.group_scores && typeof d.group_scores === 'object' ? d.group_scores : {};
    const scoreMap = new Map(Object.entries(scores).filter(([,value]) => value != null && value !== '' && Number.isFinite(Number(value))).map(([key,value]) => [key,Number(value)]));
    const authoritativeAdvice = Array.isArray(d.group_advice) ? d.group_advice.filter(entry => entry && typeof entry.group === 'string') : [];
    const stageAdvice = Array.isArray(d.stage_advice) ? d.stage_advice.filter(entry => entry && (typeof entry.stage_label === 'string' || typeof entry.stage_label_en === 'string' || typeof entry.stage_label_zh === 'string')) : [];
    const localizedField = (entry, base) => {
      const selected = L === 'en' ? entry[`${base}_en`] : entry[`${base}_zh`];
      const fallback = L === 'en' ? entry[`${base}_zh`] : entry[`${base}_en`];
      return selected || entry[base] || fallback || '';
    };
    for (const entry of stageAdvice) {
      const label = localizedField(entry, 'stage_label');
      const detail = localizedField(entry, 'suggestion');
      if (typeof detail === 'string' && detail.trim()) authoritativeAdvice.push({group:`stage-${entry.stage_index}`, group_label:label, suggestion:detail.trim()});
    }
    const returnedFeedback = Array.isArray(result?.feedback)
      ? result.feedback.map(entry => localizedField(entry || {}, 'message')).filter(value => typeof value === 'string' && value.trim())
      : [];
    if (!Number.isFinite(score) && !Object.keys(scores).length && !authoritativeAdvice.length && !stageAdvice.length && !returnedFeedback.length) {
      return {text:c.details, advice:c.details, item};
    }
    const weakGroups = Object.keys(groupTeaching)
      .filter(key => scoreMap.has(key) && weak[key] === true)
      .map(key => ({key,score:scoreMap.get(key)})).sort((a,b) => a.score-b.score).slice(0,2);
    const advice = [];
    for (const entry of authoritativeAdvice) {
      const mapped = groupTeaching[entry.group];
      const label = entry[`group_label_${L}`] || entry[`related_stage_label_${L}`]
        || localizedField(entry, 'group_label')
        || (L === 'en' ? mapped?.en : mapped?.zh) || entry.group;
      const suggestion = localizedField(entry, 'suggestion');
      const stageDetail = localizedField(entry, 'related_stage_detail');
      const selectedDetail = typeof stageDetail === 'string' && stageDetail.trim() ? stageDetail.trim()
        : (typeof suggestion === 'string' && suggestion.trim() ? suggestion.trim() : (mapped ? (L === 'en' ? mapped.tipEn : mapped.tipZh) : ''));
      if (!selectedDetail) continue;
      advice.push(L === 'en'
        ? `Let’s give ${label} one more focused try: ${selectedDetail}`
        : `我们再把「${label}」单独练一遍：${selectedDetail}`);
      if (advice.length >= 2) break;
    }
    if (returnedFeedback.length) advice.push(...returnedFeedback.slice(0, Math.max(0, 2 - advice.length)));
    if (!advice.length) advice.push(...weakGroups.map(({key,score:value}) => {
      const mapped = groupTeaching[key];
      const label = L === 'en' ? mapped.en : mapped.zh;
      const tip = L === 'en' ? mapped.tipEn : mapped.tipZh;
      return L === 'en' ? `${label} (${Math.round(value)}): ${tip}` : `【${label} ${Math.round(value)}分】${tip}`;
    }));
    const focusedGroups = Array.isArray(d.group_focus) ? d.group_focus : [];
    const allFocusedGroupsAvailable = focusedGroups.length > 0 && focusedGroups.every(key => scoreMap.has(key) && weak[key] === false);
    const thresholdValue = result?.pass_threshold ?? d.pass_threshold;
    const threshold = thresholdValue == null || thresholdValue === '' ? NaN : Number(thresholdValue);
    const passed = Number.isFinite(score) && Number.isFinite(threshold) && score >= threshold;
    if (!advice.length) advice.push(allFocusedGroupsAvailable
      ? (L === 'en' ? 'Wonderful work! Your scored key movement details are looking strong—keep it up!' : '做得真棒！本次有评分的关键动作都完成得很好，继续保持！')
      : (L === 'en' ? 'You’re making progress! Let’s compare once more with the reference and focus on one movement detail at a time.' : '你已经在进步啦！我们再对照示范看一遍，每次专注练好一个动作细节。'));
    const praise = passed
      ? (L === 'en' ? 'Wonderful job—you matched today’s practice goal!' : '太棒了！这次练习达到目标，继续保持！')
      : '';
    const text = [praise, ...advice].filter(Boolean).join('\n') || c.details;
    return {text, advice:advice.join('\n') || c.details, item, weakGroups};
  }
  function classify(text, locale) {
    const s=String(text||'').toLowerCase(), en=locale==='en';
    if (/(meaning|mean|定义|意思|语义|词汇|词义)/i.test(s)) return 'meaning';
    if (/(order|sequence|first|next|顺序|先后|步骤|怎么做|动作)/i.test(s)) return 'order';
    if (/(together|simultaneous|同时|局部|特征)/i.test(s)) return 'features';
    if (/(video|reference|示范|动画|视频|参考)/i.test(s)) return 'watch';
    if (/(practice|camera|练习|摄像头|开始)/i.test(s)) return 'practice';
    if (/(score|评分|分数|结果|怎么看)/i.test(s)) return 'score';
    return en ? 'unknown' : 'unknown';
  }
  function render(container, options) {
    const L=lang(options.locale), c=copy[L], item=options.item;
    const questions=[['meaning',c.askMeaning],['order',c.askOrder],['score',c.askScore]];
    const history=Array.isArray(options.history) ? options.history : [];
    container.innerHTML=`<aside class="teacher-agent" aria-label="${esc(c.title)}">
      <div class="teacher-agent-log" data-log role="log" aria-live="polite" aria-relevant="additions text"></div>
      <div class="teacher-agent-questions">${questions.map(([id,label])=>`<button type="button" data-intent="${id}">${esc(label)}</button>`).join('')}</div>
      <form class="teacher-agent-form"><label class="teacher-agent-sr-only" for="teacher-agent-question">${esc(c.input)}</label><input id="teacher-agent-question" name="question" type="text" autocomplete="off" placeholder="${esc(c.input)}"><button type="submit">${esc(c.send)}</button></form></aside>`;
    const log=container.querySelector('[data-log]');
    const avatarHost=container.parentElement?.querySelector('[data-teacher-launch-avatar]');
    const ownsAvatar=!options.avatar;
    const avatar=options.avatar || (global.TeacherAvatar && avatarHost ? global.TeacherAvatar.mount(avatarHost,{label:c.title}) : null);
    function appendMessage(message) { const bubble=document.createElement('div'); bubble.className=`teacher-bubble teacher-bubble-${message.who}`; if(message.scoreFeedback) bubble.dataset.scoreFeedback='true'; bubble.textContent=message.text; log.appendChild(bubble); log.scrollTop=log.scrollHeight; }
    function say(text, who='coach', state='speaking') { const message={text,who}; history.push(message); appendMessage(message); if(who==='coach') { avatar?.setState(state); avatar?.speak(text); } }
    history.forEach(appendMessage);
    if (!history.length) say(welcome(item,L));
    function replaceScoreFeedback(result) {
      const feedback = scoreFeedback(result,item,L).text;
      const d=result?.diagnostics || {}, mode=String(d.scoring_mode || result?.level || '').toLowerCase();
      const raw=result?.score, score=raw == null || raw === '' ? NaN : Number(raw);
      const thresholdValue=result?.pass_threshold ?? d.pass_threshold;
      const threshold=thresholdValue == null || thresholdValue === '' ? NaN : Number(thresholdValue);
      const validJudgment=result?.score_valid === true && Number.isFinite(score) && Number.isFinite(threshold) && !mode.includes('fallback') && !mode.includes('capture_quality');
      const avatarState=validJudgment ? (score >= threshold ? 'happy' : 'thinking') : 'idle';
      const previousIndex = history.findIndex(message => message.scoreFeedback);
      if (previousIndex >= 0) history.splice(previousIndex,1);
      const message={text:feedback,who:'coach',scoreFeedback:true};
      history.push(message);
      const previous = log.querySelector('[data-score-feedback]');
      if (previous) previous.remove();
      appendMessage(message);
      avatar?.setState(avatarState);
      avatar?.speak(feedback);
      return feedback;
    }
    function intent(id) { const result=answer(item,id,L); say(result.text); if(result.action) container.dispatchEvent(new CustomEvent('teacher-action',{bubbles:true,detail:result.action})); }
    container.querySelectorAll('[data-intent]').forEach(btn=>btn.addEventListener('click',()=>{say(btn.textContent,'learner');intent(btn.dataset.intent);}));
    container.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();options.close();}});
    container.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click',()=>container.dispatchEvent(new CustomEvent('teacher-action',{bubbles:true,detail:btn.dataset.action}))));
    container.querySelector('form').addEventListener('submit',e=>{e.preventDefault(); const input=e.currentTarget.elements.question, value=input.value.trim(); if(!value)return; say(value,'learner'); const kind=classify(value,L); intent(kind); input.value='';});
    if(options.result) replaceScoreFeedback(options.result);
    return {say, intent, replaceScoreFeedback, history, destroy:()=>{if(ownsAvatar) avatar?.destroy();}};
  }
  global.TeacherAgent={render,answer,scoreFeedback,classify,welcome};
})(window);
