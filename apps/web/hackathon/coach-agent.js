/*
 * 手语小宇宙 —— 前置问答伴学 Agent（coach-agent.js）
 * 普通浏览器脚本：本地检索 + 教学契约溯源作答，不调用任何云模型或密钥。
 * 用法：<script src="coach-agent.js"></script>，然后 window.CoachAgent.answer(q, pack)
 */
(function (w) {
  var CONTRACT_URL = '../assets/content/interactive_learning_contracts.json';

  // 47 个科普馆词条名（用于判断"有词条文字说明、但练习未上线"）
  var ENTRY_ONLY_NAMES = ['你好', '谢谢', '再见', '对不起', '爸爸', '妈妈', '我', '你', '他', '吃饭',
    '睡觉', '上学', '电话', '水', '树', '太阳', '苹果', '米饭', '学习', '老师',
    '学生', '书', '地铁', '飞机', '熊猫', '鱼', '跑步', '游泳', '文化', '艺术',
    '音乐', '高兴', '难过', '交流'];

  var FALLBACK_WORDS = [
    { id: 'chaoshi', zh: '超市', en: 'supermarket', pinyin: 'chaoshi',
      summary_zh: '双手在身前表示推车前行，再表示挑选商品。',
      ordered_sequence: [
        { label_zh: '双手握拳置于胸前', detail_zh: '两手松握拳，拳心相对，位置在胸前。' },
        { label_zh: '向前推出', detail_zh: '双拳同时向前平推，模拟推购物车。' },
        { label_zh: '收回并取物', detail_zh: '一手收回，另一手做拿取商品的动作。' }],
      simultaneous_features: [
        { label_zh: '手形', features_zh: ['松握拳', '单手张开'] },
        { label_zh: '位置', features_zh: ['胸前', '身前'] }],
      minimum_distinct_frames: 4, scoring_template_status: 'available', practice_word: '超市' },
    { id: 'gongjiaoche', zh: '公交车', en: 'bus', pinyin: 'gongjiaoche',
      summary_zh: '双手比出方向盘并转向，表示乘坐公交。',
      ordered_sequence: [
        { label_zh: '双手握方向盘', detail_zh: '两手在胸前虚握，如握方向盘。' },
        { label_zh: '左右转动', detail_zh: '两手同步左右转动，模拟转向。' }],
      simultaneous_features: [
        { label_zh: '手形', features_zh: ['虚握'] },
        { label_zh: '运动', features_zh: ['左右转动'] }],
      minimum_distinct_frames: 3, scoring_template_status: 'available', practice_word: '公交车' },
    { id: 'qiche1', zh: '汽车（一）', en: 'car (1)', pinyin: 'qiche',
      summary_zh: '单手握方向盘并向前微推，表示汽车。',
      ordered_sequence: [
        { label_zh: '单手握盘', detail_zh: '一手在胸前虚握方向盘。' },
        { label_zh: '向前微推', detail_zh: '手向前轻推一下，表示车行进。' }],
      simultaneous_features: [{ label_zh: '手形', features_zh: ['虚握'] }],
      minimum_distinct_frames: 3, scoring_template_status: 'available', practice_word: '汽车（一）' }];

  var cache = null;
  var degradedFlag = false;

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s\u3000]+/g, '');
  }

  function wrap(v) {
    if (w.Promise) { return w.Promise.resolve(v); }
    return { then: function (f) { return wrap(f(v)); } };
  }

  function loadContracts() {
    if (cache) { return wrap({ words: cache, degraded: degradedFlag }); }
    function done(words, degraded) {
      cache = words; degradedFlag = !!degraded;
      return { words: words, degraded: degradedFlag };
    }
    if (!w.fetch) { return wrap(done(FALLBACK_WORDS, true)); }
    return fetch(CONTRACT_URL).then(function (r) {
      if (!r.ok) { throw new Error('http ' + r.status); }
      return r.json();
    }).then(function (data) {
      var list = null;
      if (data) {
        if (Object.prototype.toString.call(data) === '[object Array]') {
          list = data;
        } else if (data.contracts && data.contracts.length) {
          list = data.contracts;
        } else if (data.words && data.words.length) {
          list = data.words;
        }
      }
      if (!list || !list.length) { throw new Error('empty'); }
      var ok = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].zh) { ok.push(list[i]); }
      }
      if (!ok.length) { throw new Error('no usable word'); }
      return done(ok, false);
    })['catch'](function () { return done(FALLBACK_WORDS, true); });
  }

  function findWord(query, words) {
    var list = (words && words.length) ? words : (cache || FALLBACK_WORDS);
    var q = norm(query);
    if (!q) { return null; }
    var i, k, it, pool;
    function scan(fields) {
      for (var a = 0; a < list.length; a++) {
        for (var b = 0; b < fields.length; b++) {
          var v = list[a][fields[b]];
          if (v && norm(v).indexOf(q) >= 0) { return list[a]; }
        }
      }
      return null;
    }
    for (i = 0; i < list.length; i++) {
      it = list[i];
      pool = [it.zh, it.practice_word, it.id];
      for (k = 0; k < pool.length; k++) {
        if (pool[k] && norm(pool[k]) === q) { return it; }
      }
    }
    // 拼音：只在查询里的纯字母段上匹配，避免「gongjiao怎么打」这种混排失配
    var latin = String(query).toLowerCase().replace(/[^a-z]/g, '');
    if (latin.length >= 3) {
      for (i = 0; i < list.length; i++) {
        if (list[i].pinyin && deTone(norm(list[i].pinyin)).indexOf(latin) >= 0) { return list[i]; }
      }
    }
    it = scan(['pinyin', 'en', 'id', 'zh']);
    if (it) { return it; }
    // 词名被包含在问句里：先整名，再括号前的基名（「人们（人民）」→「人们」）
    for (i = 0; i < list.length; i++) {
      if (list[i].zh && q.indexOf(norm(list[i].zh)) >= 0) { return list[i]; }
    }
    for (i = 0; i < list.length; i++) {
      var base = String(list[i].zh || '').split('（')[0];
      if (base.length >= 2 && q.indexOf(norm(base)) >= 0) { return list[i]; }
    }
    return null;
  }

  function hasAny(q, arr) {
    for (var i = 0; i < arr.length; i++) { if (q.indexOf(arr[i]) >= 0) { return true; } }
    return false;
  }

  function parseIntent(query) {
    var q = norm(query);
    if (!q) { return 'unknown'; }
    if (hasAny(q, ['注意', '易错', '难点', '关键', '别错', '容易错'])) { return 'care'; }
    if (hasAny(q, ['第几', '阶段', '细节', '分解', '具体', '步骤'])) { return 'detail'; }
    if (hasAny(q, ['哪些词', '词表', '有什么词', '能学什么', '列表', '多少词'])) { return 'list'; }
    if (hasAny(q, ['能练', '上线', '可以练', '有没有', '能不能', '能学', '支持'])) { return 'available'; }
    if (hasAny(q, ['怎么打', '怎么做', '怎么比', '动作', '要点', '怎么', '如何'])) { return 'how'; }
    if (hasAny(q, ['你是谁', '你好', '怎么用', '能做什么', '帮助', 'hello', 'help'])) { return 'help'; }
    return 'unknown';
  }

  function entryName(query) {
    var q = norm(query);
    for (var i = 0; i < ENTRY_ONLY_NAMES.length; i++) {
      if (q.indexOf(norm(ENTRY_ONLY_NAMES[i])) >= 0) { return ENTRY_ONLY_NAMES[i]; }
    }
    return null;
  }

  function practiceOk(it) { return !!(it && it.scoring_template_status === 'available'); }

  var GATED = { '人们（人民）': 1, '汽车（二）': 1 };

  function isGated(it) { return !!(it && GATED[it.zh]); }

  function deTone(s) {
    s = String(s || '');
    var map = {
      'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
      'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
      'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
      'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
      'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
      'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v', 'ü': 'v'
    };
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      out += map[ch] || ch;
    }
    return out.replace(/\s+/g, '');
  }

  function seqLines(it, withDetail, max) {
    var out = [], seq = (it && it.ordered_sequence) || [], i, s;
    for (i = 0; i < seq.length && out.length < max; i++) {
      s = seq[i];
      out.push(withDetail ? (s.label_zh + '：' + (s.detail_zh || '')) : s.label_zh);
    }
    return out;
  }

  function answer(query, pack) {
    var words = (pack && pack.words) || cache || FALLBACK_WORDS;
    var degraded = !!(pack && pack.degraded) || degradedFlag;
    var intent = parseIntent(query);
    var word = findWord(query, words);
    var st = word ? (practiceOk(word) ? 'practice' : 'entry_only')
      : (entryName(query) ? 'entry_only' : 'unknown');
    var lines, title;

    if (intent === 'list') {
      var names = [], i;
      for (i = 0; i < words.length && names.length < 10; i++) {
        if (practiceOk(words[i])) { names.push(words[i].zh); }
      }
      return { state: 'practice', intent: intent, word: null,
        title: '目前可以练习的词（前 10 个）',
        lines: names.length ? names : ['暂无可练习词，请稍后再试'],
        canPractice: true, hint: '也可以直接问「超市怎么打？」', degraded: degraded };
    }

    if (intent === 'help' || st === 'unknown') {
      var isHelp = (intent === 'help');
      return { state: 'unknown', intent: isHelp ? 'help' : intent, word: null,
        title: isHelp ? '我是手语小宇宙的伴学助手' : '这个词还没有收录',
        lines: isHelp ? ['我用本地教学契约回答手语动作要点，答案都有出处，不编造。',
          '可以问我：某个词怎么打、阶段细节、易错点、哪些词能练。',
          '示例：「超市怎么打？」「有哪些词可以练？」']
          : ['我暂时没有这个词的动作说明，也不做猜测。',
            '目前可练习的词见「有哪些词可以练？」，其他科普馆词条仅提供文字说明。'],
        canPractice: false, hint: '点下方示例问法试一下，或直接输入词名。', degraded: degraded };
    }

    if (st === 'entry_only') {
      var name = word ? word.zh : entryName(query);
      lines = ['「' + name + '」目前仅有词条文字说明，打分练习尚未正式上线。'];
      if (word) { lines = lines.concat(seqLines(word, false, 4)); }
      lines.push('可先浏览词条说明，练习上线后即可进入。');
      return { state: 'entry_only', intent: intent, word: word || null,
        title: name + ' · 仅词条说明', lines: lines, canPractice: false,
        hint: '想看能练的词，可以问「有哪些词可以练？」', degraded: degraded };
    }

    if (intent === 'detail') {
      title = word.zh + ' 的分阶段细节';
      lines = seqLines(word, true, 5);
      if (!lines.length) { lines = [word.summary_zh || '']; }
    } else if (intent === 'care') {
      title = word.zh + ' 的注意点';
      lines = [];
      var sf = word.simultaneous_features || [], j;
      for (j = 0; j < sf.length && lines.length < 4; j++) {
        lines.push(sf[j].label_zh + '：' + (sf[j].features_zh || []).join('、'));
      }
      lines.push('最少可辨帧数 ' + (word.minimum_distinct_frames || 3) + '，动作要做完整。');
    } else if (intent === 'available') {
      title = word.zh + ' 的练习状态';
      if (isGated(word)) {
        lines = ['该词有练习入口，但训练样本仅 39 条，属门控豁免词，不出置信度评分。',
          word.summary_zh || ''];
      } else {
        lines = ['该词已上线，可直接进入练习。', word.summary_zh || ''];
      }
      if (degraded) { lines.push('当前使用离线兜底数据，练习仍可进行。'); }
    } else {
      title = word.zh + ' 的打法';
      lines = [word.summary_zh || ''].concat(seqLines(word, false, 6));
    }
    if (isGated(word)) {
      lines = ['注意：本词样本不足，可以进练习，但不会给出分数。'].concat(lines);
    }
    return { state: 'practice', intent: intent, word: word, title: title, lines: lines,
      canPractice: true, gatedNoScore: isGated(word),
      hint: isGated(word)
        ? '进练习后对照示范自查；该词不出分，是刻意设计。'
        : '点下方按钮进入练习，对着摄像头做动作即可打分。',
      degraded: degraded };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderAnswer(ans) {
    if (!ans) { return ''; }
    var pill = ans.gatedNoScore ? '<span class="pill warn">可练但不评分</span>'
      : (ans.state === 'practice' ? '<span class="pill ok">可练习</span>'
        : (ans.state === 'entry_only' ? '<span class="pill warn">练习未上线</span>'
          : '<span class="pill no">未收录</span>'));
    var h = '<div class="agent-answer"><div class="aa-title">' + esc(ans.title) + ' ' + pill + '</div>';
    var lines = ans.lines || [];
    if (lines.length) {
      h += '<ul class="aa-lines">';
      for (var i = 0; i < lines.length; i++) { h += '<li>' + esc(lines[i]) + '</li>'; }
      h += '</ul>';
    }
    if (ans.hint) { h += '<div class="note">' + esc(ans.hint) + '</div>'; }
    if (ans.degraded) { h += '<div class="note honest">离线兜底数据</div>'; }
    return h + '</div>';
  }

  function suggestChips(words) {
    var list = (words && words.length) ? words : (cache || FALLBACK_WORDS);
    var DEMO = ['超市', '公交车', '汽车（一）'];
    var pick = [], i, used = {};
    for (i = 0; i < DEMO.length; i++) {
      for (var j = 0; j < list.length; j++) {
        if (list[j].zh === DEMO[i]) { pick.push(list[j]); used[DEMO[i]] = 1; break; }
      }
    }
    for (i = 0; i < list.length && pick.length < 2; i++) {
      if (practiceOk(list[i]) && !used[list[i].zh]) { pick.push(list[i]); }
    }
    var a = pick[0] ? pick[0].zh : '超市';
    var b = pick[1] ? pick[1].zh : '公交车';
    return [a + '怎么打？', b + '要注意什么？', '有哪些词可以练？', '超市第 2 阶段怎么做？'];
  }

  w.CoachAgent = {
    loadContracts: loadContracts, findWord: findWord, parseIntent: parseIntent,
    answer: answer, renderAnswer: renderAnswer, suggestChips: suggestChips,
    ENTRY_ONLY_NAMES: ENTRY_ONLY_NAMES
  };
})(window);
