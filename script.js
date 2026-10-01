// ГородТолк — логика форума и модерация комментариев (ТЗ v1.1, этапы 1–8).
// Проверка перед публикацией — локальные правила: конфигурация ниже,
// точки входа — moderateComment() и evaluateModeration().

const STORAGE_KEY = "gorodtolk-comments";

// ---------------------------------------------------------------------------
// Конфигурация модерации. Этап 1 плана реализации (ТЗ разд. 9.2, 10.2).
// Все настройки вынесены в константы, чтобы правила не содержали «зашитых»
// чисел: порог строгости и списки слов меняются здесь, без правки логики.
// ---------------------------------------------------------------------------

// "rules" — проверка по локальным правилам. Режим по умолчанию: работает
// офлайн и при открытии по file://, без ключа и без сетевых запросов.
// "api" — этап 2, внешний ИИ через серверный прокси. Ключ API в браузере
// хранить нельзя: он виден любому посетителю (ТЗ SEC-01, SEC-02).
const MODERATION_MODE = "rules";

// Порог, начиная с которого комментарий не публикуется сразу: набрано столько
// баллов — отправляем на ручную проверку. Один блокирующий признак (вес 100)
// уводит комментарий сразу, три средних (по 40) — тоже; один средний (40)
// и один слабый (15) публикуются. Решение заказчика: копить баллы, а не
// блокировать по единственному признаку (ТЗ FR-07, п. 19).
const MODERATION_THRESHOLD = 100;

// Причина в метке модератора не должна превращаться в простыню (FR-09).
const REASON_MAX_LEN = 80;

// Отдельный ключ для положения переключателя «Режим модератора», чтобы не
// смешивать его с массивом комментариев и не потерять при перезагрузке (FR-19).
const MODERATOR_MODE_KEY = "gorodtolk-moderator-mode";

// Домены, ссылки на которые не считаются рекламой (понижают вес правила R01):
// для городского форума обсуждать новость со ссылкой на источник — норма.
const ALLOWED_DOMAINS = [
  "gorodtolk.ru",
  "wikipedia.org",
  "gov.ru",
  "mos.ru",
  "gosuslugi.ru",
  "ria.ru",
  "tass.ru"
];

// Стартовые словари (ТЗ Приложение А). Хранятся локально, никуда не передаются.
// Пополняются здесь же; проверка идёт по границам слов, поэтому «дурацкий» не
// ловится словом «дурак».
const MODERATION_DICTIONARIES = {
  // Матерные слова и грубые выражения — правило R02.
  // «*» в конце = совпадение по началу слова («пизд*» ловит «пиздец»,
  // «пиздить»). Без «*» — строго всё слово целиком, чтобы «сукно»
  // не совпадало с «сука» и «займёт» — с «займ».
  profanity: [
    "хуй*", "хуя*", "хуе*", "пизд*", "бляд*", "бля*",
    "ебан*", "ебат*", "ебать", "ебал", "заеб*", "выеб*", "ебн*", "ебуч*",
    "уеб*", "нахуй*", "похуй*", "оху*", "аху*",
    "сука", "суки", "сучий", "сучка",
    "мудак*", "мудил*",
    "ублюдок*",
    "долбоеб*", "долбоёб*",
    "гандон*", "залуп*",
    "жоп*", "срак*", "манда", "говн*", "дерьм*",
    "пидор*", "пидар*", "пидр*", "педик*",
    "чмо", "чмошник*"
  ],

  // Оскорбления людей — правило R02.
  insults: [
    "дурак*", "идиот*", "урод*", "кретин*", "дебил*", "болван*",
    "тупой", "тупая", "тупое", "тупые", "тупищ*",
    "пень", "мраз*", "сволоч*", "сволочь", "гад",
    "подлец*", "негодяй*", "выродок*",
    "ничтожество", "бездарность", "позорище",
    "жалкий", "ничтожный", "никчемный", "бестолочь",
    "козел*", "дегенерат*", "гнида*", "падл*", "твар*",
    "имбицил*", "гомик*"
  ],

  // Признаки рекламы и заработка на спаме — правило R04. Два уровня:
  // adWords (вес 100, блокирует сама) — заведомо рекламный лексикон;
  // adWordsSoft (вес 40, добавляет баллы) — слова, которые встречаются
  // и в обычной городской речи («акция ко Дню города», «биржа труда»),
  // поэтому поодиночке комментарий не удерживают.
  adWords: [
    "казино*", "ставк*", "букмекер*", "капча*",
    "крипт*", "инвестиц*", "инвестор*",
    "заработок*", "подработка*", "работа для всех",
    "кредит под 0", "кредит наличными", "займ", "займы", "микрозайм*",
    "финансовая пирамида", "пирамид*",
    "выгодное предложение", "переходите по ссылке", "жми сюда", "жми",
    "кликай*", "подпишись*",
    "секс*", "порно*", "массажистк*",
    // Англоязычный спам — форум русскоязычный, но рассылки на латинице
    // встречаются, и словари их не видят.
    "crypto*", "bitcoin*", "invest*", "casino*", "viagra*",
    "click here", "make money", "work from home", "free money", "winner*"
  ],

  adWordsSoft: [
    "скидка*", "акция*", "распродажа*", "бирж*",
    "вакансия*", "набор в", "уборка помещений"
  ],

  // Увод в личные контакты и мессенджеры — правило R03.
  contactWords: [
    "пишите в личку", "пиши в личку", "в личку", "в личку ко мне",
    "напишите мне", "звоните", "звони мне", "мой номер",
    "телеграм*", "в тг", "в вотсап*", "whatsapp*",
    "в вк", "вконтакте*", "инстаграм*", "в директ", "директ"
  ]
};

// ---------------------------------------------------------------------------
// Этап 2: нормализация текста и правила модерации (ТЗ, разд. 10.1–10.2).
// Точка входа — evaluateModeration(text) -> { approved, reason, score, rules }.
// Связывание с moderateComment() выполняется на этапе 3.
// ---------------------------------------------------------------------------

// Разрешённые разделители внутри обфусцированного слова: "х * й", "x-u-y"
// и "h t t p" распознаются как целое слово.
const DEOBFUSCATION_SEPARATORS = "\\s\\-_.·•*#~";

// Латинские буквы, которые часто подменяют кириллицей (и наоборот):
// "xуй" -> "хуй", "дурaк" -> "дурак".
const HOMOGLYPHS_LAT_TO_CYR = {
  a: "а", b: "в", c: "с", e: "е", h: "н",
  k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у"
};
const HOMOGLYPHS_CYR_TO_LAT = {};
Object.keys(HOMOGLYPHS_LAT_TO_CYR).forEach((lat) => {
  HOMOGLYPHS_CYR_TO_LAT[HOMOGLYPHS_LAT_TO_CYR[lat]] = lat;
});

// Один и тот же визуальный символ в разных алфавитах считаем одной буквой,
// чтобы «ахахahaha» не пряталось от подсчёта повторов.
function unifyHomoglyphs(str) {
  let out = "";
  for (const ch of str) out += HOMOGLYPHS_LAT_TO_CYR[ch] || ch;
  return out;
}

// Начало/конец слова для ограничений: соседняя буква или цифра означает,
// что мы внутри слова, и совпадать нельзя (ТЗ: «нехороший» ≠ «хороший»).
const WORD_EDGE = "(?![0-9а-яa-zё])";
const WORD_START = "(^|[^0-9а-яa-zё])";

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Кэш: словарь статичен, regex компилируется один раз на термин.
const TERM_REGEX_CACHE = new Map();

// Из словарного термина строится regex с разделителями между буквами.
// «*» в конце термина — совпадение по началу слова без границы справа.
function buildTermRegex(term) {
  const cached = TERM_REGEX_CACHE.get(term);
  if (cached) return cached;

  const isPrefix = term.endsWith("*");
  const core = isPrefix ? term.slice(0, -1) : term;
  const separator = "[" + DEOBFUSCATION_SEPARATORS + "]*";

  let body = "";
  for (const ch of core) {
    if (ch === " ") {
      body += separator;
      continue;
    }
    const twin = HOMOGLYPHS_LAT_TO_CYR[ch] || HOMOGLYPHS_CYR_TO_LAT[ch];
    // Позиция буквы принимает и двойника-омоглиф, и «заполнитель»:
    // в «х*й» звёздочка подменяет пропущенную букву «у».
    body += "[" + escapeRegExp(ch) + (twin ? escapeRegExp(twin) : "") + "*#?]";
  }

  const re = new RegExp(WORD_START + body + (isPrefix ? "" : WORD_EDGE), "i");
  TERM_REGEX_CACHE.set(term, re);
  return re;
}

function findDictionaryHit(text, terms) {
  for (const term of terms) {
    if (buildTermRegex(term).test(text)) return term;
  }
  return null;
}

function collapseRepeatedWords(text) {
  // "до до до до" -> "до": схлопываем повтор одного и того же слова подряд.
  let prev = null;
  let result = text;
  for (let i = 0; i < 3 && result !== prev; i++) {
    prev = result;
    result = result.replace(/\b(\S+)\s+\1\b/g, "$1");
  }
  return result;
}

function normalizeComment(rawText) {
  const original = rawText == null ? "" : String(rawText);

  // Шаг 2: невидимые символы, HTML-теги, диакритика.
  const visible = original
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/[\u0300-\u036F\u0489]/g, "");

  // Шаг 1: нижний регистр, ё -> е, схлопывание пробелов.
  const low = visible
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

  // Шаги 3 и 4: свёртка повторов символов и повторов слов.
  const collapsed = collapseRepeatedWords(low.replace(/([^\s])\1+/g, "$1"));

  // Шаг 6: метрики. Капс считаем до приведения регистра, повторы — на low.
  const letters = visible.match(/[а-яёa-z]/gi) || [];
  const upperLetters = (visible.match(/[А-ЯЁA-Z]/g) || []).length;
  const withoutSpaces = unifyHomoglyphs(low.replace(/\s/g, ""));
  const charCounts = {};
  for (const ch of withoutSpaces) charCounts[ch] = (charCounts[ch] || 0) + 1;
  const maxCharShare = withoutSpaces.length
    ? Math.max(...Object.values(charCounts)) / withoutSpaces.length
    : 0;

  const words = collapsed.split(/[^0-9а-яa-zё]+/).filter(Boolean);
  const wordCounts = {};
  for (const w of words) {
    if (w.length >= 4) wordCounts[w] = (wordCounts[w] || 0) + 1;
  }

  return {
    original,
    visible,
    low,                       // до свёртки: ищем повторы символов/слов
    collapsed,                 // после свёртки: база для словарей и метрик
    noSpace: collapsed.replace(/\s+/g, ""), // для ссылок вида "h t t p ://"
    words,
    links: findLinks(low),
    phone: findPhone(low),
    mention: /@[a-zа-яё0-9_]{3,}/i.test(low),
    profanityHit: findDictionaryHit(collapsed, MODERATION_DICTIONARIES.profanity),
    insultHit: findDictionaryHit(collapsed, MODERATION_DICTIONARIES.insults),
    adHit: findDictionaryHit(collapsed, MODERATION_DICTIONARIES.adWords),
    adSoftHit: findDictionaryHit(collapsed, MODERATION_DICTIONARIES.adWordsSoft),
    contactHit: findDictionaryHit(collapsed, MODERATION_DICTIONARIES.contactWords),
    metrics: {
      length: original.length,
      lettersCount: letters.length,
      capsRatio: letters.length ? upperLetters / letters.length : 0,
      maxCharShare,
      wordCount: words.length,
      maxWordRepeat: Math.max(0, ...Object.values(wordCounts)),
      mixedWords: words.filter((w) => /[a-z]/i.test(w) && /[а-яё]/i.test(w)).length,
      hasEmoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(original),
      hasLetter: letters.length > 0,
      hasNonSpace: withoutSpaces.length > 0
    }
  };
}

// Домен считаем ссылкой, если после точки идёт известный TLD — это отсекает
// ложные срабатывания на датах (09.2026) и перечислениях (и.т.д).
const TLD_RE = /(?:[a-z0-9а-яё-]+\.)+(?:ru|com|net|org|io|me|info|club|online|shop|store|xyz|top|click|pro|site|su|by|kz|ua|de|uk|us|wiki)/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-z]{2,}/gi;
const RAW_LINK_RE = /(?:https?:\/\/|www\.)[^\s]*/gi;

// Извлекаем домен из «http://site.ru/path» или «www.site.ru».
function domainOf(raw) {
  return raw
    .replace(/^(?:https?:\/\/|www\.)/i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
}

function findLinks(text) {
  const hits = new Set();
  // Оба варианта: «site.ru» и обфусцированный вид «site . ru» / «h t t p:// site».
  const variants = [text, text.replace(/\s+/g, "")];
  for (const variant of variants) {
    TLD_RE.lastIndex = 0;
    EMAIL_RE.lastIndex = 0;
    RAW_LINK_RE.lastIndex = 0;
    let match;
    while ((match = TLD_RE.exec(variant)) !== null) hits.add(match[0].toLowerCase());
    while ((match = EMAIL_RE.exec(variant)) !== null) hits.add(match[0].toLowerCase());
    // Протокол или www. — ссылка по определению, даже если TLD неизвестен
    // (bit.ly, cc и другие короткие домены).
    while ((match = RAW_LINK_RE.exec(variant)) !== null) hits.add(domainOf(match[0]));
  }
  return Array.from(hits);
}

function isAllowedLink(domain) {
  return ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

// Телефон: +7/8 с кодом либо чистые 10–11 цифр либо формат 3-3-4.
// Короткие цифровые последовательности (даты, цены) не считаем телефоном.
const PHONE_RE = /(?:\+\d[\d\s\-()]{6,14}\d|\b\d{10,11}\b|\b\d{3}[\s-]\d{3}[\s-]\d{4}\b)/g;

function findPhone(text) {
  PHONE_RE.lastIndex = 0;
  return PHONE_RE.test(text);
}

// Правила ТЗ, разд. 10.2. Вес — число баллов; approved считается по порогу.
// reason — справочная строка из Приложения Б, пользовательский текст не подставляется.
const MODERATION_RULES = [
  {
    id: "R01",
    weight: 100,
    reason: "похоже на рекламу — внешняя ссылка",
    test: (n) => n.links.some((d) => !isAllowedLink(d))
  },
  {
    id: "R02",
    weight: 100,
    reason: (n) => (n.profanityHit ? "грубые выражения" : "оскорбление участника"),
    test: (n) => Boolean(n.profanityHit || n.insultHit)
  },
  {
    id: "R03",
    weight: 100,
    reason: "контактные данные или увод в мессенджер",
    test: (n) => n.phone || n.mention || Boolean(n.contactHit)
  },
  {
    id: "R04",
    // «Явные» рекламные слова весят 100 (блокируют), «сомнительные» — 40.
    weight: (n) => (n.adHit ? 100 : 40),
    reason: "рекламные формулировки",
    test: (n) => Boolean(n.adHit || n.adSoftHit)
  },
  {
    id: "R05",
    weight: 100,
    reason: "повторяющийся текст, похоже на спам",
    // Три одинаковых слова подряд, повтор одного слова 3+ раз в коротком
    // тексте, либо один символ занимает больше 30% текста.
    test: (n) =>
      /\b(\S+)\s+\1\s+\1\b/.test(n.low) ||
      n.metrics.maxWordRepeat >= 3 ||
      n.metrics.maxCharShare > 0.3
  },
  {
    id: "R06",
    weight: (n) => (n.metrics.capsRatio >= 0.9 && n.metrics.length >= 100 ? 100 : 40),
    reason: "слишком много заглавных букв",
    test: (n) => n.metrics.capsRatio > 0.7 && n.metrics.lettersCount > 20
  },
  {
    id: "R07",
    weight: 40,
    reason: "повторяющиеся символы, похоже на спам",
    test: (n) => /(.)\1{3,}/.test(n.low)
  },
  {
    id: "R08",
    weight: 40,
    reason: "слишком короткий комментарий",
    // 1–2 слова, среди которых эмодзи или грубое слово.
    test: (n) =>
      n.metrics.wordCount <= 2 &&
      (n.metrics.hasEmoji || Boolean(n.profanityHit || n.insultHit))
  },
  {
    id: "R09",
    weight: 40,
    reason: "слишком длинный комментарий",
    test: (n) => n.metrics.length > 1500
  },
  {
    id: "R10",
    weight: 40,
    reason: "подозрительное написание слов",
    test: (n) => n.metrics.mixedWords >= 2
  },
  {
    id: "R11",
    weight: 15,
    reason: "резкий тон",
    // Три восклицательных/вопросительных подряд, но не четыре и больше —
    // четыре уже попадают под более тяжёлое правило R07.
    test: (n) => /[!?]{3}/.test(n.low) && !/(.)\1{3,}/.test(n.low)
  },
  {
    id: "R12",
    weight: 40,
    reason: "нет текста для модерации",
    test: (n) => n.metrics.hasNonSpace && !n.metrics.hasLetter
  }
];

function resolveWeight(rule, n) {
  return typeof rule.weight === "function" ? rule.weight(n) : rule.weight;
}

function evaluateModeration(text) {
  const n = normalizeComment(text);

  if (!n.collapsed) {
    return { approved: false, reason: "пустой комментарий", score: MODERATION_THRESHOLD, rules: [] };
  }

  const fired = []; // { id, weight, reason }
  for (const rule of MODERATION_RULES) {
    if (!rule.test(n)) continue;
    fired.push({
      id: rule.id,
      weight: resolveWeight(rule, n),
      reason: typeof rule.reason === "function" ? rule.reason(n) : rule.reason
    });
  }

  const score = fired.reduce((sum, hit) => sum + hit.weight, 0);
  const approved = score < MODERATION_THRESHOLD;

  // Причина — две самые весомые, по убыванию веса; при равенстве — порядок
  // следования правил в таблице. Ограничение длины (FR-09).
  let reason = "";
  if (!approved) {
    reason = fired
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((hit) => hit.reason)
      .join("; ");
    if (reason.length > REASON_MAX_LEN) reason = reason.slice(0, REASON_MAX_LEN - 1).trimEnd() + "…";
  }

  return { approved, reason, score, rules: fired.map((hit) => hit.id) };
}

function loadComments() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];

  // Этап 5: FR-11 / D-01 — миграция старых записей при чтении.
  // Запись без approved трактуется как опубликованная (иначе все старые
  // комментарии разом ушли бы в очередь модератора), createdAt дополняется
  // датой импорта. Результат сохраняется сразу, чтобы дата не «плавала»
  // при каждой перезагрузке; дальше миграция ничего не меняет.
  const importedAt = new Date().toISOString();
  let migrated = false;
  const comments = stored.map((raw) => {
    const item = raw && typeof raw === "object" ? raw : { name: "", text: "" };
    const approved = typeof item.approved === "boolean" ? item.approved : true;
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : importedAt;
    const reason = typeof item.reason === "string" ? item.reason : "";
    if (item.approved !== approved || item.createdAt !== createdAt || item.reason !== reason) {
      migrated = true;
    }
    return Object.assign({}, item, { approved, createdAt, reason });
  });

  if (migrated) {
    try {
      saveComments(comments);
    } catch {
      // Хранилище недоступно (например, переполнено) — чтение не ломаем.
    }
  }
  return comments;
}

function saveComments(comments) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
}

// Положение переключателя «Режим модератора» (FR-19): по умолчанию false,
// хранится отдельно от данных и не зависит от массива комментариев.
function isModeratorMode() {
  try {
    return localStorage.getItem(MODERATOR_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

// Этап 3: реализация вместо заглушки (ТЗ, разд. 9.1, FR-01).
// Контракт всегда асинхронный — единый для локальных правил и для будущего
// режима "api" (LLM через серверный прокси). Функция никогда не бросает
// исключений наружу: любая ошибка деградирует в source: "fallback", чтобы
// публикация комментариев не ломалась ни при каком сбое проверки.
async function moderateComment(text) {
  try {
    // MODERATION_MODE === "api" заработает на этапе 2 плана (LLM через
    // серверный прокси). Пока ключа и бэкенда нет — работают локальные
    // правила: режим "api" деградирует на них, но не роняет публикацию.
    const source = "rules";
    const result = evaluateModeration(text);

    // Страховка инвариантов контракта на границе (разд. 9.1):
    // reason === "" строго при approved === true, длина <= REASON_MAX_LEN.
    let reason = result.approved ? "" : result.reason;
    if (!result.approved && !reason) reason = "на проверку модератора";
    if (reason.length > REASON_MAX_LEN) {
      reason = reason.slice(0, REASON_MAX_LEN - 1).trimEnd() + "…";
    }

    return {
      approved: result.approved,
      reason,
      score: result.score,
      rules: result.rules,
      source
    };
  } catch {
    return {
      approved: false,
      reason: "не удалось проверить автоматически",
      score: 0,
      rules: [],
      source: "fallback"
    };
  }
}

// Этап 6: UI режима модератора (ТЗ UI-05/UI-06/UI-08, FR-18).
// Счётчик и подпись обновляются при каждом вызове render(), то есть при
// каждом изменении списка; чекбокс отражает сохранённое состояние.
function updateModeratorControls(comments) {
  const pending = comments.filter((comment) => !comment.approved).length;

  const counter = document.getElementById("queueCounter");
  if (counter) counter.textContent = "На проверке: " + pending;

  const moderatorMode = isModeratorMode();
  const subtitle = document.getElementById("feedSubtitle");
  if (subtitle) {
    subtitle.textContent = moderatorMode
      ? "Очередь на проверку модератора"
      : "Общая лента";
  }

  const toggle = document.getElementById("moderatorMode");
  if (toggle) toggle.checked = moderatorMode;

  // Кнопка очистки ленты — только в режиме модератора (вне ТЗ,
  // добавлено по запросу после этапа 8): в общей ленте скрыта.
  const clearBtn = document.getElementById("clearFeedBtn");
  if (clearBtn) clearBtn.hidden = !moderatorMode;
}

function render() {
  // Этап 5: FR-04 / FR-17 — обычная лента показывает только одобренные
  // записи, режим модератора — только очередь на проверку.
  const moderatorMode = isModeratorMode();
  const comments = loadComments();
  const list = document.getElementById("commentList");
  list.innerHTML = "";

  // UI-06/UI-08: счётчик и подпись следуют за каждым изменением списка,
  // в том числе когда очередь пуста (счётчик «На проверке: 0»).
  updateModeratorControls(comments);

  const visible = comments.filter((comment) =>
    moderatorMode ? !comment.approved : comment.approved
  );

  // FR-20: пустая очередь — заглушка вместо пустого списка.
  if (moderatorMode && visible.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "Очередь пуста";
    list.appendChild(empty);
    return;
  }

  visible.forEach((comment) => {
    const li = document.createElement("li");
    if (!comment.approved) li.className = "comment-flagged";

    const nameEl = document.createElement("div");
    nameEl.className = "comment-name";
    nameEl.textContent = comment.name;

    const textEl = document.createElement("p");
    textEl.textContent = comment.text;

    li.appendChild(nameEl);
    li.appendChild(textEl);

    if (!comment.approved) {
      const flag = document.createElement("span");
      flag.className = "flag-label";
      flag.textContent = "На проверке модератора" + (comment.reason ? ": " + comment.reason : "");
      li.appendChild(flag);
    }

    list.appendChild(li);
  });
}

// Этап 6: переключатель «Режим модератора» (ТЗ UI-05, FR-18/FR-19/FR-21).
// Включение/выключение меняет только вид ленты: данные не трогаются,
// перезагрузка не нужна, состояние переживает F5 через localStorage.
const moderatorToggle = document.getElementById("moderatorMode");
if (moderatorToggle) {
  moderatorToggle.addEventListener("change", () => {
    try {
      localStorage.setItem(MODERATOR_MODE_KEY, moderatorToggle.checked ? "true" : "false");
    } catch {
      // Хранилище недоступно — режим всё равно действует до перезагрузки.
    }
    render();
  });
}

// Кнопка «Очистить ленту» (вне ТЗ, добавлено по запросу после этапа 8):
// видна только в режиме модератора, требует подтверждения. Удаляет только
// комментарии; режим модератора и другие данные не трогает.
const clearFeedBtn = document.getElementById("clearFeedBtn");
if (clearFeedBtn) {
  clearFeedBtn.addEventListener("click", () => {
    const confirmed = window.confirm(
      "Удалить все комментарии? Это действие нельзя отменить."
    );
    if (!confirmed) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Хранилище недоступно — очистить нечего.
    }
    render();
  });
}

// Этап 4: интеграция асинхронной проверки в отправку формы
// (ТЗ, FR-02, FR-03, FR-12, FR-13, FR-14; устранение D-03 и D-05).

// Таймер автоочистки плашки: сбрасывается при каждой новой отправке,
// чтобы старое уведомление не стёрло свежее.
let noticeTimer = null;

function setNotice(message, autoClearAfterMs, isSuccess) {
  const notice = document.getElementById("moderationNotice");
  notice.textContent = message;
  // UI-03: при одобрении плашка нейтрально-зелёная, при отказе — прежняя.
  notice.classList.toggle("success", Boolean(isSuccess));
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  if (message && autoClearAfterMs > 0) {
    noticeTimer = setTimeout(() => {
      notice.textContent = "";
      notice.classList.remove("success");
      noticeTimer = null;
    }, autoClearAfterMs);
  }
}

// Защита от повторного сабмита, пока идёт проверка (FR-12).
let submitting = false;

document.getElementById("commentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const name = document.getElementById("commentName").value.trim();
  const text = document.getElementById("commentText").value.trim();
  if (submitting || !name || !text) return;

  // Блокировка кнопки на время проверки: неактивна, надпись «Проверяем…».
  submitting = true;
  const button = form.querySelector("button[type='submit']") || form.querySelector("button");
  const buttonLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Проверяем…";
  setNotice("", 0);

  let result;
  try {
    // FR-02/FR-03: проверка ровно один раз и строго до записи в хранилище.
    result = await moderateComment(text);
  } catch {
    // moderateComment по контракту не бросает, но даже нарушение контракта
    // не должно терять комментарий пользователя (D-05, US-4).
    result = { approved: false, reason: "не удалось проверить автоматически", source: "fallback" };
  }

  try {
    // FR-15: результат проверки сохраняется в модели для разбора.
    const now = new Date().toISOString();
    const comments = loadComments();
    comments.unshift({
      name,
      text,
      approved: result.approved,
      reason: result.reason,
      createdAt: now,
      moderation: {
        source: result.source,
        score: result.score,
        rules: result.rules,
        at: now
      }
    });
    saveComments(comments);
    form.reset();
    render();

    if (result.approved) {
      // FR-14: уведомление об успешной отправке само исчезает через 5 секунд.
      // Формулировка — как в UI-03.
      setNotice("Комментарий опубликован.", 5000, true);
    } else {
      // FR-13: формулировка стартового проекта — дословно.
      setNotice("Комментарий отправлен на проверку модератора и пока не виден всем.", 0);
    }
  } finally {
    button.disabled = false;
    button.textContent = buttonLabel;
    submitting = false;
  }
});

render();
