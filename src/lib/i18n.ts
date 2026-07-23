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
  step2Title: string;
  step2Hint: string;
  specializationLabel: string;
  generalFocus: string;
  specializationOtherPlaceholder: string;
  nameLabel: string;
  namePlaceholder: string;
  back: string;
  next: string;
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
  chooseHint: string;
  questionCounter: (n: number) => string;
  topicPrefix: string;
  levelWord: string;
  ceilingProbe: string;
  warmup: string;
  overall: string;
  outOf: string;
  selfAssessment: string;
  assessmentFor: string;
  verdictLabel: string;
  weakPointsLabel: string;
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
    step2Title: "Narrow it down",
    step2Hint: "Pick a focus so the questions match your stack, or keep it general.",
    specializationLabel: "Focus / stack",
    generalFocus: "General",
    specializationOtherPlaceholder: "e.g. Python, GCP, LLM agents (Keras, Gemini, ADK)",
    nameLabel: "Your name or id (optional)",
    namePlaceholder: "e.g. Mohamed, or emp-204",
    back: "Back",
    next: "Next",
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
    chooseHint: "Pick the best answer",
    questionCounter: (n) => `Question ${n}`,
    topicPrefix: "Probing",
    levelWord: "Level",
    ceilingProbe: "Testing your ceiling",
    warmup: "Warm-up",
    overall: "Overall",
    outOf: "of 1000",
    selfAssessment: "Self-assessment",
    assessmentFor: "Assessment for",
    verdictLabel: "Verdict",
    weakPointsLabel: "Weak points",
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
    step2Title: "حدّد أكتر",
    step2Hint: "اختار تخصص عشان الأسئلة تبقى على الـ stack بتاعك، أو سيبها عامة.",
    specializationLabel: "التخصص / الـ stack",
    generalFocus: "عام",
    specializationOtherPlaceholder: "مثلا Python, GCP, LLM agents (Keras, Gemini, ADK)",
    nameLabel: "اسمك أو رقمك (اختياري)",
    namePlaceholder: "مثلا محمد، أو emp-204",
    back: "رجوع",
    next: "التالي",
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
    chooseHint: "اختر الإجابة الأنسب",
    questionCounter: (n) => `سؤال ${n}`,
    topicPrefix: "بيقيس",
    levelWord: "مستوى",
    ceilingProbe: "بنختبر أقصى مستوى عندك",
    warmup: "تسخين",
    overall: "الإجمالي",
    outOf: "من 1000",
    selfAssessment: "تقييم ذاتي",
    assessmentFor: "تقييم لـ",
    verdictLabel: "الخلاصة",
    weakPointsLabel: "نقاط الضعف",
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

// Step 2 suggestions: a specialization narrows a broad role to a real stack, so
// "Backend" is measured as "Backend, Python" and an ML role can be pinned to
// "LLM agents (Gemini, ADK)". Suggestions are chips that pre-fill the focus; the
// user can always type their own via "Other". Kept in English (technical terms)
// in both languages. A custom / unknown role falls back to GENERIC_SPECIALIZATIONS.
export const GENERIC_SPECIALIZATIONS = [
  "Cloud / LLM agents",
  "Python / Data + ML",
  "Web / APIs",
  "Mobile / Apps",
] as const;

export const SPECIALIZATIONS_BY_ROLE: Record<string, readonly string[]> = {
  "Backend Engineer": ["Python (Django/FastAPI)", "Node / TypeScript", "Java / Spring", "Go"],
  "Frontend Engineer": ["React / Next.js", "Vue / Nuxt", "Angular", "Svelte"],
  "Full-Stack Engineer": ["Next.js + Node", "Django + React", "Laravel + Vue", "MERN"],
  "Mobile Engineer": ["Flutter", "iOS (Swift)", "Android (Kotlin)", "React Native"],
  "DevOps Engineer": ["AWS", "GCP", "Kubernetes", "Terraform / IaC"],
  "Data Scientist": ["Python / pandas", "ML modeling", "SQL / analytics", "Deep learning"],
  "Machine Learning Engineer": [
    "LLM agents (Gemini, ADK)",
    "PyTorch / Keras",
    "MLOps / serving",
    "GCP Vertex AI",
  ],
  "Security Engineer": ["AppSec", "Cloud security", "Network / infra", "Pentesting"],
  "Product Manager": ["B2B SaaS", "Consumer", "Growth", "Platform / API"],
  "UX Designer": ["Product design", "Design systems", "UX research", "Interaction / motion"],
};

// Suggestions for the picked role, or the generic set for a custom role.
export function specializationsFor(role: string): readonly string[] {
  return SPECIALIZATIONS_BY_ROLE[role] ?? GENERIC_SPECIALIZATIONS;
}
