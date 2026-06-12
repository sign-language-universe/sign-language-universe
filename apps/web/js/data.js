/* =============================================
   手语小宇宙 — 数据层
   词汇分类体系：按《国家通用手语水平测试词表》
   一级 = 最常用基础词汇
   二级 = 进阶词汇
   三级 = 高级词汇
   ============================================= */

const VOCABULARY_DATA = {
  // 一级星系（基础）
  level1: {
    name: '银河系 · 一级',
    level: 1,
    description: '最常用基础词汇',
    planets: [
      {
        id: 'greetings',
        name: '问候星球',
        emoji: '👋',
        color: '#4de8a0',
        words: [
          { id: 'ni-hao', word: '你好', pinyin: 'nǐ hǎo', definition: '一手伸出拇指，自然弯曲，在胸前向上点动两下。', usage: '日常问候用语，用于见面打招呼。', category: '问候' },
          { id: 'xie-xie', word: '谢谢', pinyin: 'xiè xiè', definition: '一手伸出拇指，向前弯曲两下，表示谢意。', usage: '表达感谢。', category: '问候' },
          { id: 'zai-jian', word: '再见', pinyin: 'zài jiàn', definition: '一手五指微曲，向前挥动。', usage: '告别时使用。', category: '问候' },
          { id: 'dui-bu-qi', word: '对不起', pinyin: 'duì bù qǐ', definition: '一手在胸前掌心向上微动，表示歉意。', usage: '道歉用语。', category: '问候' },
          { id: 'hao', word: '好', pinyin: 'hǎo', definition: '一手伸出拇指，表示"好"。', usage: '表示肯定、赞同。', category: '问候' }
        ]
      },
      {
        id: 'family',
        name: '家人星球',
        emoji: '👨‍👩‍👧',
        color: '#4da6ff',
        words: [
          { id: 'baba', word: '爸爸', pinyin: 'bà ba', definition: '一手伸出拇指，指尖抵在下巴处。', usage: '指称父亲。', category: '家庭' },
          { id: 'mama', word: '妈妈', pinyin: 'mā ma', definition: '一手伸出食指，指尖抵在脸颊处。', usage: '指称母亲。', category: '家庭' },
          { id: 'wo', word: '我', pinyin: 'wǒ', definition: '一手食指指向自己胸前。', usage: '第一人称代词。', category: '人称' },
          { id: 'ni', word: '你', pinyin: 'nǐ', definition: '一手食指指向对方。', usage: '第二人称代词。', category: '人称' },
          { id: 'ta', word: '他', pinyin: 'tā', definition: '一手食指指向侧方。', usage: '第三人称代词。', category: '人称' },
          { id: 'pengyou', word: '朋友', pinyin: 'péng yǒu', definition: '两根大拇指模拟两个人的头，两个人的头互相碰两下，象征亲密。', usage: '指好友、伙伴。', category: '人际' }
        ]
      },
      {
        id: 'daily',
        name: '日常星球',
        emoji: '🏠',
        color: '#ffd93d',
        words: [
          { id: 'chi-fan', word: '吃饭', pinyin: 'chī fàn', definition: '一手模仿往嘴里送食物的动作。', usage: '表示进食。', category: '日常' },
          { id: 'shui-jiao', word: '睡觉', pinyin: 'shuì jiào', definition: '一手掌心贴在脸颊旁，头微侧。', usage: '表示睡觉。', category: '日常' },
          { id: 'shang-xue', word: '上学', pinyin: 'shàng xué', definition: '双手模拟"读书"动作，然后向前移动。', usage: '表示去学校学习。', category: '日常' },
          { id: 'dian-hua', word: '电话', pinyin: 'diàn huà', definition: '一手伸出拇指和小指，放在耳旁。', usage: '表示打电话。', category: '日常' },
          { id: 'shui', word: '水', pinyin: 'shuǐ', definition: '一手食指和中指并拢，模仿喝水的动作。', usage: '表示水或喝水。', category: '日常' }
        ]
      },
      {
        id: 'nature',
        name: '自然星球',
        emoji: '🌙',
        color: '#9b59ff',
        words: [
          { id: 'yueliang', word: '月亮', pinyin: 'yuè liàng', definition: '双手向两边移动，两根手指距离逐渐变窄，模拟弯月形状。', usage: '指月亮。', category: '自然' },
          { id: 'hua', word: '花', pinyin: 'huā', definition: '一手撮合、指尖朝上模仿花朵含苞的样子，手缓缓向上同时慢慢张开，模仿开花。', usage: '指花朵、鲜花。', category: '自然' },
          { id: 'shui2', word: '树', pinyin: 'shù', definition: '一手五指张开，手腕为树干，手指为树枝，从下往上延伸。', usage: '指树木。', category: '自然' },
          { id: 'taiyang', word: '太阳', pinyin: 'tài yáng', definition: '一手握拳，手指向外展开，模仿太阳光芒。', usage: '指太阳。', category: '自然' }
        ]
      },
      {
        id: 'food',
        name: '美食星球',
        emoji: '🍌',
        color: '#ffd93d',
        words: [
          { id: 'xiangjiao', word: '香蕉', pinyin: 'xiāng jiāo', definition: '左手竖着的食指表示香蕉，右手从左手食指上往下做剥皮动作。', usage: '指水果香蕉。', category: '食物' },
          { id: 'pingguo', word: '苹果', pinyin: 'píng guǒ', definition: '一手五指微曲，在脸颊旁轻轻扭动，模拟苹果圆润的样子。', usage: '指苹果。', category: '食物' },
          { id: 'mifan', word: '米饭', pinyin: 'mǐ fàn', definition: '双手捧碗状，一手做扒饭进嘴的动作。', usage: '指米饭。', category: '食物' }
        ]
      }
    ]
  },

  // 二级星系（进阶）
  level2: {
    name: '仙女星系 · 二级',
    level: 2,
    description: '进阶实用词汇',
    planets: [
      {
        id: 'education',
        name: '学习星球',
        emoji: '📚',
        color: '#9b59ff',
        words: [
          { id: 'xue-xi', word: '学习', pinyin: 'xué xí', definition: '双手虚拟翻书的动作。', usage: '表示学习、读书。', category: '教育' },
          { id: 'lao-shi', word: '老师', pinyin: 'lǎo shī', definition: '一手伸出拇指，从额头向上一挑。', usage: '指称教师。', category: '教育' },
          { id: 'xue-sheng', word: '学生', pinyin: 'xué shēng', definition: '双手虚拟翻书后，手指指向自己胸前。', usage: '指称学生。', category: '教育' },
          { id: 'shu', word: '书', pinyin: 'shū', definition: '双手掌心相对，做翻书的动作。', usage: '指书籍。', category: '教育' }
        ]
      },
      {
        id: 'transport',
        name: '交通星球',
        emoji: '🚗',
        color: '#ff8c42',
        words: [
          { id: 'qiche', word: '汽车', pinyin: 'qì chē', definition: '双手模拟开车的动作，两手虚握想象手心内是方向盘，双手左右转动。', usage: '指汽车、开车。', category: '交通' },
          { id: 'gong-che', word: '公交车', pinyin: 'gōng jiāo chē', definition: '双手模拟握方向盘，身体微晃。', usage: '指公共汽车。', category: '交通' },
          { id: 'di-tie', word: '地铁', pinyin: 'dì tiě', definition: '一手食指在下方横向移动，表示地下铁路。', usage: '指地铁。', category: '交通' },
          { id: 'fei-ji', word: '飞机', pinyin: 'fēi jī', definition: '一手伸出拇指、食指和小指，从下往上飞行。', usage: '指飞机。', category: '交通' }
        ]
      },
      {
        id: 'animals',
        name: '动物星球',
        emoji: '🐯',
        color: '#ff8c42',
        words: [
          { id: 'hu', word: '虎', pinyin: 'hǔ', definition: '左手食指在前额比出"王"字，随后双手五指弯曲向前按动，模仿老虎兽爪。', usage: '指老虎。', category: '动物' },
          { id: 'xiong', word: '熊猫', pinyin: 'xióng māo', definition: '双手食指在两眼旁画圆圈，模仿熊猫的黑眼圈。', usage: '指熊猫。', category: '动物' },
          { id: 'yu', word: '鱼', pinyin: 'yú', definition: '一手五指并拢，做鱼尾摆动的动作向前游动。', usage: '指鱼。', category: '动物' }
        ]
      },
      {
        id: 'actions',
        name: '动作星球',
        emoji: '🦘',
        color: '#4de8a0',
        words: [
          { id: 'tiao', word: '跳', pinyin: 'tiào', definition: '右手食、中指模拟人的两条腿，在左手"地面"上交替弹跳。', usage: '表示跳跃动作。', category: '动作' },
          { id: 'pao', word: '跑步', pinyin: 'pǎo bù', definition: '双手前后交替摆动，模仿跑步时手臂运动。', usage: '表示跑步。', category: '动作' },
          { id: 'you', word: '游泳', pinyin: 'yóu yǒng', definition: '双手交替向前划水，身体微侧。', usage: '表示游泳。', category: '动作' }
        ]
      }
    ]
  },

  // 三级星系（高级）
  level3: {
    name: '猎户星系 · 三级',
    level: 3,
    description: '高级进阶词汇',
    planets: [
      {
        id: 'culture',
        name: '文化星球',
        emoji: '🎭',
        color: '#ff6b9d',
        words: [
          { id: 'wen-hua', word: '文化', pinyin: 'wén huà', definition: '双手在胸前做展开的动作，表示文化的传播。', usage: '指文化。', category: '文化' },
          { id: 'yi-shu', word: '艺术', pinyin: 'yì shù', definition: '一手五指微张，在面前做波浪状移动。', usage: '指艺术。', category: '文化' },
          { id: 'chang-ge', word: '唱歌', pinyin: 'chàng gē', definition: '头部左右晃动，双手拇指和食指同时从喉部向外移出，表示发出声音。', usage: '指唱歌。', category: '文化' },
          { id: 'yin-yue', word: '音乐', pinyin: 'yīn yuè', definition: '双手模拟弹奏乐器的动作。', usage: '指音乐。', category: '文化' }
        ]
      },
      {
        id: 'expressions',
        name: '情感星球',
        emoji: '😋',
        color: '#ff6b9d',
        words: [
          { id: 'chan', word: '馋', pinyin: 'chán', definition: '一手伸食指在嘴角处向下滑动，模仿口水从嘴角流出的样子，表示嘴馋。', usage: '表示嘴馋、想吃的样子。', category: '情感' },
          { id: 'gaoxing', word: '高兴', pinyin: 'gāo xìng', definition: '双手在胸前向上圆弧运动，同时面部展开笑容。', usage: '表示高兴、开心。', category: '情感' },
          { id: 'nan-guo', word: '难过', pinyin: 'nán guò', definition: '一手放在胸口，缓缓向下移动，表达心中难受。', usage: '表示难过、悲伤。', category: '情感' }
        ]
      },
      {
        id: 'social',
        name: '社交星球',
        emoji: '👆',
        color: '#4da6ff',
        words: [
          { id: 'zhishi', word: '指示', pinyin: 'zhǐ shì', definition: '一手伸出食指，指向某个方向或物体，表示指示、指引的意思。', usage: '表示指出、指引方向。', category: '社交' },
          { id: 'jiaoliu', word: '交流', pinyin: 'jiāo liú', definition: '双手食指相对，交替前后移动，表示信息双向流动。', usage: '表示交流、沟通。', category: '社交' },
          { id: 'bangzhu', word: '帮助', pinyin: 'bāng zhù', definition: '一手放在另一手下方，将另一手向上托举。', usage: '表示帮助、协助。', category: '社交' }
        ]
      }
    ]
  }
};

// 手语小知识（文化/语法提示）
const CULTURE_TIPS = [
  '在中国手语中，问候语通常伴随微笑的表情和点头的体态，这些非手控特征也是手语的重要组成部分。',
  '手语的"类标记"（Classifier）是手语独有的语法现象，用于描述物体的形状、大小、位置和运动方式。',
  '中国手语中，"你和我"仅靠手型无法区分方向，必须结合空间位置和面部朝向来表达。',
  '指拼（Fingerspelling）是手语的重要组成部分，用于拼写外来词、新造词和人名。',
  '手语不是对口语的逐字翻译，它有自己独立的语法体系，语序可能与汉语不同。',
  '聋人文化强调视觉交流和直接表达，打手语时目光接触非常重要。',
  '同一手势在不同国家手语中可能有完全不同的含义，学习时要注意区分。',
  '手语表达中，速度、幅度、力度都会影响语义，就像口语中的语调和重音。'
];

// 测评题目
const QUIZ_QUESTIONS = [
  {
    type: 'choice',
    question: '观看视频，这个手语表示什么？',
    videoHint: '👋 手语视频播放中...',
    options: ['你好', '再见', '谢谢', '对不起'],
    correct: 0
  },
  {
    type: 'choice',
    question: '以下哪个是"谢谢"的正确手语？',
    videoHint: '🤚 手语视频 A',
    options: ['伸出拇指弯曲两下', '五指微曲向前挥动', '食指指向自己', '模拟翻书动作'],
    correct: 0
  },
  {
    type: 'translation',
    question: '请将以下手语句子翻译成中文：',
    videoHint: '👐 手语视频播放中...',
    options: ['你好，很高兴认识你', '再见，明天见', '谢谢你的帮助', '对不起，我迟到了'],
    correct: 0
  }
];

// 表达测评词汇列表
const EXPRESSION_WORDS = [
  { word: '你好', difficulty: 1 },
  { word: '谢谢', difficulty: 1 },
  { word: '爸爸', difficulty: 1 },
  { word: '学习', difficulty: 2 },
  { word: '文化', difficulty: 3 }
];

// =============================================
//  3D 模型映射（评分>80 时奖励弹窗展示模型）
//  glbPath：本地 .glb 文件路径（空字符串 = 尚未生成模型）
// =============================================
const MODEL_MAP = {
  '香蕉': { label: '香蕉', emoji: '🍌', color: '#ffd93d', shape: 'banana', glbPath: 'assets/3d/banana.glb' },
  '花':   { label: '花',   emoji: '🌸', color: '#ff6b9d', shape: 'flower', glbPath: 'assets/3d/flower.glb' },
  '汽车': { label: '汽车', emoji: '🚗', color: '#4da6ff', shape: 'car',     glbPath: 'assets/3d/steering_wheel.glb' },
  '虎':   { label: '虎',   emoji: '🐯', color: '#ff8c42', shape: 'tiger',   glbPath: 'assets/3d/tiger_head.glb' },
  '月亮': { label: '月亮', emoji: '🌙', color: '#4de8a0', shape: 'moon',    glbPath: '' },
  '跳':   { label: '跳',   emoji: '🦘', color: '#9b59ff', shape: 'runner',  glbPath: 'assets/3d/runner.glb' },
  '朋友': { label: '朋友', emoji: '👫', color: '#ffd93d', shape: 'sphere',  glbPath: '' },
  '指示': { label: '指示', emoji: '👆', color: '#4da6ff', shape: 'sphere',  glbPath: '' },
  '唱歌': { label: '唱歌', emoji: '🎤', color: '#ff6b9d', shape: 'sphere',  glbPath: '' },
  '馋':   { label: '馋',   emoji: '😋', color: '#ff8c42', shape: 'sphere',  glbPath: '' }
};

// =============================================
//  挑战模式词汇
//  列表覆盖全部学习词汇；只有模板库已覆盖的词开放正式评分。
// =============================================
const SCORING_READY_WORD_LIST = [
  '香蕉', '花', '汽车', '虎', '月亮', '跳', '朋友', '指示', '唱歌', '馋'
];
const SCORING_READY_WORDS = new Set(SCORING_READY_WORD_LIST);

const CHALLENGE_WORD_EXTRAS = {
  '香蕉': { model: '香蕉', hasRewardModel: true },
  '花': { model: '花', hasRewardModel: true },
  '汽车': { model: '汽车', hasRewardModel: true },
  '虎': { model: '虎', hasRewardModel: true },
  '月亮': { model: '月亮', hasRewardModel: false },
  '跳': { model: '跳', hasRewardModel: true },
  '朋友': { model: '朋友', hasRewardModel: false },
  '指示': { model: '指示', hasRewardModel: false },
  '唱歌': { model: '唱歌', hasRewardModel: false },
  '馋': { model: '馋', hasRewardModel: false }
};

function buildChallengeWords() {
  const words = [];
  const seen = new Set();
  Object.values(VOCABULARY_DATA).forEach(level => {
    level.planets.forEach(planet => {
      planet.words.forEach(item => {
        if (seen.has(item.word)) return;
        seen.add(item.word);
        const extra = CHALLENGE_WORD_EXTRAS[item.word] || {};
        const scoringReady = SCORING_READY_WORDS.has(item.word);
        words.push({
          ...item,
          level: level.level,
          planet: planet.name,
          originalOrder: words.length,
          model: extra.model || item.word,
          scoringReady,
          hasRewardModel: Boolean(extra.hasRewardModel && MODEL_MAP[extra.model]?.glbPath),
          statusLabel: scoringReady ? '评分模板已上线' : '评分模板待上线',
          statusText: scoringReady
            ? '可以使用 Web Holistic + ModelScope lite 后端进行模板评分。'
            : '这个学习词汇还没有标准动作模板，暂时不能录制打分；可先学习打法，等待评分数据库上线。'
        });
      });
    });
  });
  return words
    .sort((a, b) => {
      if (a.scoringReady !== b.scoringReady) return a.scoringReady ? -1 : 1;
      if (a.scoringReady) {
        return SCORING_READY_WORD_LIST.indexOf(a.word) - SCORING_READY_WORD_LIST.indexOf(b.word);
      }
      return a.originalOrder - b.originalOrder;
    })
    .map(({ originalOrder, ...word }) => word);
}

const CHALLENGE_WORDS = buildChallengeWords();
