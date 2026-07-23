// Bilingual UI copy. Arabic is deliberately simple and everyday; technical terms
// (role titles, Ctrl + Enter) stay in English. No em-dash or en-dash anywhere.

export type UILang = "en" | "ar";

export interface UIStrings {
  appName: string;
  tagline: string;
  setupTitle: string;
  setupHint: string;
  roleLabel: string;
  rolePlaceholder: string;
  otherRole: string;
  personaToggle: string;
  yearsLabel: string;
  backgroundLabel: string;
  backgroundPlaceholder: string;
  start: string;
  starting: string;
  formingQuestion: string;
  grading: string;
  composing: string;
  answerPlaceholder: string;
  submit: string;
  submitHint: string;
  questionCounter: (n: number) => string;
  topicPrefix: string;
  levelWord: string;
  ceilingProbe: string;
  warmup: string;
  overall: string;
  outOf: string;
  selfAssessment: string;
  strengths: string;
  gaps: string;
  learningPath: string;
  restart: string;
  copyLink: string;
  copied: string;
  errorGeneric: string;
  langToggle: string;
}

export const UI: Record<UILang, UIStrings> = {
  en: {
    appName: "Depth",
    tagline: "See how deep your knowledge really goes.",
    setupTitle: "What should we measure?",
    setupHint: "Name a role. The assessment builds itself around it.",
    roleLabel: "Pick a role",
    rolePlaceholder: "e.g. Senior Backend Engineer",
    otherRole: "Other",
    personaToggle: "Add your background (optional)",
    yearsLabel: "Years of experience",
    backgroundLabel: "Short background",
    backgroundPlaceholder: "e.g. 5 years in Java and distributed systems",
    start: "Begin",
    starting: "Reading the role...",
    formingQuestion: "Forming your question...",
    grading: "Reading your answer...",
    composing: "Composing your report...",
    answerPlaceholder: "Type your answer. Take your time.",
    submit: "Submit",
    submitHint: "Ctrl + Enter",
    questionCounter: (n) => `Question ${n}`,
    topicPrefix: "Probing",
    levelWord: "Level",
    ceilingProbe: "Testing your ceiling",
    warmup: "Warm-up",
    overall: "Overall",
    outOf: "of 1000",
    selfAssessment: "Self-assessment",
    strengths: "Strengths",
    gaps: "Gaps",
    learningPath: "Where to go next",
    restart: "Assess again",
    copyLink: "Copy report link",
    copied: "Link copied",
    errorGeneric: "Something went wrong. Please try again.",
    langToggle: "العربية",
  },
  ar: {
    appName: "العمق",
    tagline: "شوف معرفتك عميقة قد إيه فعلا.",
    setupTitle: "نقيس إيه؟",
    setupHint: "اكتب اسم دور. الاختبار بيتبني حواليه لوحده.",
    roleLabel: "اختار دور",
    rolePlaceholder: "مثلا Senior Backend Engineer",
    otherRole: "غير ده",
    personaToggle: "ضيف خلفيتك (اختياري)",
    yearsLabel: "سنين الخبرة",
    backgroundLabel: "خلفية قصيرة",
    backgroundPlaceholder: "مثلا 5 سنين في Java وأنظمة موزعة",
    start: "ابدأ",
    starting: "بيقرأ الدور...",
    formingQuestion: "بيجهّز سؤالك...",
    grading: "بيقرأ إجابتك...",
    composing: "بيكتب تقريرك...",
    answerPlaceholder: "اكتب إجابتك. خد وقتك.",
    submit: "إرسال",
    submitHint: "Ctrl + Enter",
    questionCounter: (n) => `سؤال ${n}`,
    topicPrefix: "بيقيس",
    levelWord: "مستوى",
    ceilingProbe: "بنختبر أقصى مستوى عندك",
    warmup: "تسخين",
    overall: "الإجمالي",
    outOf: "من 1000",
    selfAssessment: "تقييم ذاتي",
    strengths: "نقاط القوة",
    gaps: "الفجوات",
    learningPath: "الخطوة الجاية",
    restart: "قيّم تاني",
    copyLink: "انسخ رابط التقرير",
    copied: "الرابط اتنسخ",
    errorGeneric: "حصل خطأ. جرّب تاني.",
    langToggle: "English",
  },
};

export function dirFor(lang: UILang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

// Curated common roles for one-click selection. Titles stay in English in both
// languages (technical terms). Any other role is still supported via "Other".
export const ROLE_PRESETS = [
  "Backend Engineer",
  "Frontend Engineer",
  "Full-Stack Engineer",
  "Mobile Engineer",
  "DevOps Engineer",
  "Data Scientist",
  "Machine Learning Engineer",
  "Security Engineer",
  "Product Manager",
  "UX Designer",
] as const;
