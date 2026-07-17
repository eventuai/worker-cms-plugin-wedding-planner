// ============================================================
// Seed catalog for the wedding planner.
//
// The Phase-1 planner mirrors the WeVow app's Hong Kong wedding templates:
// a countdown checklist keyed by months-before-the-big-day, a preset budget
// breakdown, and a one-click wedding-day rundown. Every entry carries an
// English and a Traditional Chinese name; the new-wedding form picks which
// language the seeded pages are named in.
//
// `scopes` restricts an entry to weddings that selected any of the listed
// scope flags in the onboarding questionnaire; entries without `scopes`
// always seed.
// ============================================================

export type ScopeKey = 'registry' | 'church' | 'overseas' | 'banquet' | 'honeymoon' | 'newhome';

export const SCOPE_KEYS: ScopeKey[] = ['registry', 'church', 'overseas', 'banquet', 'honeymoon', 'newhome'];

export interface Category {
  key: string;
  /** Chip color, applied as an inline style so Tailwind purging cannot eat it. */
  color: string;
}

export const CATEGORIES: Category[] = [
  { key: 'gown', color: '#8b5cf6' },       // 婚紗禮服
  { key: 'bigday', color: '#e11d48' },     // 婚禮當日
  { key: 'photo', color: '#60a5fa' },      // 婚紗攝影
  { key: 'beauty', color: '#f472b6' },     // 化妝美容
  { key: 'venue', color: '#f59e0b' },      // 婚宴場地
  { key: 'rings', color: '#84cc16' },      // 婚戒首飾
  { key: 'honeymoon', color: '#fb7185' },  // 蜜月婚禮
  { key: 'newhome', color: '#1e3a8a' },    // 新居
  { key: 'services', color: '#b45309' },   // 婚禮服務
  { key: 'others', color: '#fdba74' },     // 其他/活動
];

export function categoryColor(key: string): string {
  return CATEGORIES.find((category) => category.key === key)?.color ?? '#9ca3af';
}

export interface TaskTemplate {
  /** Months before the wedding month (0 = the wedding month itself). */
  offset: number;
  category: string;
  en: string;
  zh: string;
  scopes?: ScopeKey[];
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  // ── 12 months before ────────────────────────────────────────────────────────
  { offset: 12, category: 'venue', en: 'Research and book the banquet venue', zh: '物色及預訂婚宴場地', scopes: ['banquet'] },
  { offset: 12, category: 'bigday', en: 'Book the ceremony venue', zh: '預訂證婚場地', scopes: ['registry', 'church'] },
  { offset: 12, category: 'others', en: 'Draft the overall wedding budget', zh: '草擬婚禮整體預算' },
  { offset: 12, category: 'honeymoon', en: 'Research overseas wedding destinations', zh: '搜集海外婚禮資料', scopes: ['overseas'] },

  // ── 9 months before ─────────────────────────────────────────────────────────
  { offset: 9, category: 'gown', en: 'Collect info on gown, qun kwa and suit rental or tailoring', zh: '搜集婚紗、裙褂及男禮訂造或租用資料' },
  { offset: 9, category: 'bigday', en: 'Book the wedding-day photographer and videographer', zh: '預約婚禮攝影師及錄影師/公司' },
  { offset: 9, category: 'bigday', en: 'Book the lawyer, priest or minister', zh: '預約律師/神父或牧師', scopes: ['registry', 'church'] },
  { offset: 9, category: 'photo', en: 'Book the pre-wedding photographer', zh: '預約婚照攝影師/公司' },
  { offset: 9, category: 'beauty', en: 'Book the makeup artist and hair stylist', zh: '預約化妝/髮型師' },
  { offset: 9, category: 'newhome', en: 'Renovate and prepare household items', zh: '裝修及預備家庭用品', scopes: ['newhome'] },

  // ── 8 months before ─────────────────────────────────────────────────────────
  { offset: 8, category: 'newhome', en: 'Buy furniture for the new home', zh: '添置傢俬', scopes: ['newhome'] },

  // ── 6 months before ─────────────────────────────────────────────────────────
  { offset: 6, category: 'gown', en: 'Order the gown, qun kwa, suit and wedding shoes', zh: '預訂婚紗、裙褂及男禮及結婚鞋' },
  { offset: 6, category: 'gown', en: 'Confirm the bridesmaids and groomsmen list', zh: '確認伴娘/郎、兄弟姊妹團名單' },
  { offset: 6, category: 'rings', en: 'Order wedding rings and buy bridal jewellery', zh: '訂造結婚戒指，購置婚嫁首飾' },
  { offset: 6, category: 'honeymoon', en: 'Plan the honeymoon destination and budget', zh: '計劃蜜月地點及財政預算', scopes: ['honeymoon'] },
  { offset: 6, category: 'bigday', en: 'Book the venue decoration company', zh: '預約場地佈置公司', scopes: ['banquet'] },
  { offset: 6, category: 'bigday', en: 'Book the master of ceremonies (MC)', zh: '預約婚禮司儀', scopes: ['banquet'] },
  { offset: 6, category: 'bigday', en: 'Book the daai kam je (bridal chaperone)', zh: '預約大妗姐', scopes: ['banquet'] },
  { offset: 6, category: 'bigday', en: 'Book the bridal car', zh: '預訂花車' },
  { offset: 6, category: 'photo', en: 'Take the pre-wedding photos', zh: '拍攝婚紗照' },

  // ── 3 months before ─────────────────────────────────────────────────────────
  { offset: 3, category: 'venue', en: 'Draft the guest list and headcount', zh: '草擬嘉賓名單及出席人數', scopes: ['banquet'] },
  { offset: 3, category: 'bigday', en: 'Submit the notice of intended marriage (book the date)', zh: '遞交擬結婚通知書 (預約排期)', scopes: ['registry', 'church'] },
  { offset: 3, category: 'beauty', en: 'Start makeup and hair trials', zh: '開始試妝/髮型' },
  { offset: 3, category: 'services', en: 'Take a pre-marital health check', zh: '婚前檢查' },
  { offset: 3, category: 'services', en: 'Design and print the invitations', zh: '設計及印製喜帖' },
  { offset: 3, category: 'services', en: 'Arrange pre-marital counselling', zh: '安排婚前輔導', scopes: ['church'] },

  // ── 2 months before ─────────────────────────────────────────────────────────
  { offset: 2, category: 'gown', en: 'Arrange outfits for parents and siblings', zh: '為雙方家長、兄弟姊妹置裝' },
  { offset: 2, category: 'rings', en: 'Prepare the dowry and bridal gold jewellery', zh: '準備嫁妝、婚嫁金器' },
  { offset: 2, category: 'bigday', en: 'Order the wedding cake', zh: '訂製結婚蛋糕', scopes: ['banquet'] },
  { offset: 2, category: 'services', en: 'Choose the betrothal (guo dai lai) gift items', zh: '選擇過文定, 過大禮物品', scopes: ['banquet'] },
  { offset: 2, category: 'services', en: 'Order wine and fruit', zh: '訂洋酒、水果', scopes: ['banquet'] },
  { offset: 2, category: 'services', en: 'Buy cake cards (western and Chinese bridal cakes)', zh: '購買餅卡 (西餅及中式嫁女餅)', scopes: ['banquet'] },
  { offset: 2, category: 'services', en: 'Send out the invitations', zh: '派喜帖' },
  { offset: 2, category: 'others', en: 'Open a safe deposit box', zh: '開設保險箱' },

  // ── 1 month before ──────────────────────────────────────────────────────────
  { offset: 1, category: 'gown', en: 'Fit the gown, evening dress, qun kwa and suits', zh: '試穿婚紗、晚裝、裙掛、禮服' },
  { offset: 1, category: 'gown', en: 'Buy lingerie, hair-combing outfit and stockings', zh: '購買功能內衣、上頭套裝、絲襪等' },
  { offset: 1, category: 'bigday', en: 'Confirm the ceremony procedure with the lawyer', zh: '與律師確定證婚流程', scopes: ['registry', 'church'] },
  { offset: 1, category: 'bigday', en: 'Confirm the shooting schedule with the photographer and videographer', zh: '與攝影/錄影師確定結婚拍攝及錄影程序' },
  { offset: 1, category: 'bigday', en: 'Finalize the church programme', zh: '編訂教堂程序', scopes: ['church'] },
  { offset: 1, category: 'bigday', en: 'Prepare the return gifts for guests', zh: '準備回禮小禮物' },
  { offset: 1, category: 'bigday', en: 'Prepare gifts for the bridesmaids and groomsmen', zh: '準備兄弟姊妹禮物' },
  { offset: 1, category: 'bigday', en: 'Finalize the guest and helper lists', zh: '最後確定嘉賓及工作人員名單' },
  { offset: 1, category: 'services', en: 'Deliver the betrothal gifts and dowry', zh: '過大禮、送嫁妝', scopes: ['banquet'] },
  { offset: 1, category: 'services', en: 'Prepare the hair-combing ceremony items', zh: '準備上頭物品', scopes: ['banquet'] },
  { offset: 1, category: 'services', en: 'Prepare banquet items (tea set, red umbrella, etc.)', zh: '準備婚宴用品 (茶具、紅傘等)', scopes: ['banquet'] },
  { offset: 1, category: 'services', en: 'Order the roast pig for the bride’s homecoming', zh: '預訂回門乳豬', scopes: ['banquet'] },
  { offset: 1, category: 'services', en: 'Prepare the programme rundown and seating chart', zh: '製訂結婚程序表及座位表', scopes: ['banquet'] },
  { offset: 1, category: 'others', en: 'Apply for wedding leave', zh: '向公司請假' },

  // ── The wedding month ───────────────────────────────────────────────────────
  { offset: 0, category: 'gown', en: 'Collect the gown and outfits', zh: '取婚紗禮服' },
  { offset: 0, category: 'venue', en: 'Confirm the final table count and banquet menu with the venue', zh: '通知婚宴場地最後席數及確定婚宴菜式', scopes: ['banquet'] },
  { offset: 0, category: 'venue', en: 'Book a restaurant lunch for the helpers', zh: '預訂酒樓午膳 (招呼兄弟姊妹)', scopes: ['banquet'] },
  { offset: 0, category: 'honeymoon', en: 'Pack luggage and travel documents', zh: '準備行李及旅遊證件', scopes: ['honeymoon', 'overseas'] },
  { offset: 0, category: 'bigday', en: 'Collect the marriage authorization letter (submit to the priest/minister 2 weeks ahead)', zh: '領取婚禮授權書 (需於2星期前送交神父/牧師以便安排正式婚書)', scopes: ['registry', 'church'] },
  { offset: 0, category: 'bigday', en: 'Rehearse at the church or ceremony hall', zh: '在教堂/證婚禮堂作婚前綵排', scopes: ['registry', 'church'] },
  { offset: 0, category: 'bigday', en: 'Confirm the MC script', zh: '與司儀確定司儀稿', scopes: ['banquet'] },
  { offset: 0, category: 'bigday', en: 'Prepare cash for lai see, tips and transport', zh: '備妥現金作開門利是、小費及交通費用' },
  { offset: 0, category: 'bigday', en: 'Collect the bouquet', zh: '取花球' },
  { offset: 0, category: 'bigday', en: 'Gather the helpers and confirm the door games', zh: '舉行兄弟姊妹團聚會，確定接新娘遊戲', scopes: ['banquet'] },
  { offset: 0, category: 'bigday', en: 'Brief parents and helpers on the day’s flow and roles', zh: '向家長及各工作人員講解結婚當日程序及各人的崗位' },
  { offset: 0, category: 'bigday', en: 'Final check that no wedding or banquet item is missing', zh: '檢查所有婚禮及婚宴物品沒有遺漏' },
  { offset: 0, category: 'beauty', en: 'Final makeup trial', zh: '最後試妝' },
  { offset: 0, category: 'beauty', en: 'Skincare, brows and manicure', zh: '皮膚護理、修眉、修甲' },
  { offset: 0, category: 'services', en: 'Prepare the hair-combing ceremony', zh: '準備上頭儀式', scopes: ['banquet'] },
  { offset: 0, category: 'others', en: 'Confirm gathering points and times with everyone', zh: '與各單位確定集合地點及時間' },
];

export interface BudgetTemplate {
  category: string;
  en: string;
  zh: string;
  /** Preset HK-average style default budget, editable after seeding. */
  budget: number;
  scopes?: ScopeKey[];
}

export const BUDGET_TEMPLATES: BudgetTemplate[] = [
  { category: 'venue', en: 'Wedding banquet', zh: '婚宴酒席', budget: 200000, scopes: ['banquet'] },
  { category: 'bigday', en: 'Ceremony venue', zh: '證婚場地', budget: 8000, scopes: ['registry', 'church'] },
  { category: 'gown', en: 'Wedding gown and evening dress', zh: '婚紗及晚裝', budget: 8000 },
  { category: 'gown', en: 'Groom suit', zh: '男禮服', budget: 4000 },
  { category: 'gown', en: 'Qun kwa (bridal gown)', zh: '裙褂', budget: 6000, scopes: ['banquet'] },
  { category: 'photo', en: 'Pre-wedding photo shoot', zh: 'Pre-Wedding 婚紗攝影', budget: 15000 },
  { category: 'photo', en: 'Big-day photography and videography', zh: 'Big Day 婚禮攝影錄影', budget: 15000 },
  { category: 'beauty', en: 'Makeup and hair styling', zh: '化妝及髮型', budget: 6000 },
  { category: 'rings', en: 'Wedding rings', zh: '結婚戒指', budget: 15000 },
  { category: 'rings', en: 'Bridal gold jewellery', zh: '婚嫁金器', budget: 30000, scopes: ['banquet'] },
  { category: 'services', en: 'Invitations and stationery', zh: '喜帖印刷', budget: 2000 },
  { category: 'services', en: 'Cake cards and bridal cakes', zh: '餅卡及嫁女餅', budget: 8000, scopes: ['banquet'] },
  { category: 'services', en: 'Betrothal gift items', zh: '過大禮物品', budget: 5000, scopes: ['banquet'] },
  { category: 'services', en: 'Return gifts', zh: '回禮禮物', budget: 3000 },
  { category: 'services', en: 'MC and daai kam je', zh: '司儀及大妗姐', budget: 6000, scopes: ['banquet'] },
  { category: 'bigday', en: 'Venue decoration and flowers', zh: '場地佈置及花球', budget: 10000, scopes: ['banquet'] },
  { category: 'bigday', en: 'Bridal car', zh: '花車', budget: 3000 },
  { category: 'bigday', en: 'Lai see, tips and transport', zh: '利是、小費及交通', budget: 5000 },
  { category: 'honeymoon', en: 'Honeymoon flights and hotel', zh: '蜜月機票及酒店', budget: 40000, scopes: ['honeymoon'] },
  { category: 'newhome', en: 'New home furniture and renovation', zh: '新居傢俬及裝修', budget: 100000, scopes: ['newhome'] },
  { category: 'others', en: 'Miscellaneous', zh: '雜項', budget: 5000 },
];

export interface RundownTemplate {
  time: string;
  en: string;
  zh: string;
  scopes?: ScopeKey[];
}

export const RUNDOWN_TEMPLATES: RundownTemplate[] = [
  { time: '06:00', en: 'Makeup artist arrives; bride starts makeup', zh: '化妝師到達，新娘開始化妝' },
  { time: '07:30', en: 'Groom and groomsmen depart to fetch the bride', zh: '新郎及兄弟團出發接新娘' },
  { time: '08:00', en: 'Door games at the bride’s home', zh: '開門利是及玩新郎遊戲', scopes: ['banquet'] },
  { time: '08:30', en: 'Tea ceremony at the bride’s home', zh: '向女家父母敬茶' },
  { time: '09:30', en: 'Tea ceremony at the groom’s home', zh: '返男家向父母敬茶' },
  { time: '10:30', en: 'Church ceremony', zh: '教堂行禮', scopes: ['church'] },
  { time: '11:30', en: 'Civil ceremony and signing of the marriage certificate', zh: '證婚儀式及簽署婚書', scopes: ['registry'] },
  { time: '13:00', en: 'Lunch with the helpers', zh: '與兄弟姊妹團午膳', scopes: ['banquet'] },
  { time: '15:00', en: 'Rest and makeup touch-up at the suite', zh: '回套房休息及補妝' },
  { time: '17:00', en: 'Arrive at the banquet venue; final checks', zh: '到達婚宴場地，檢查場地佈置', scopes: ['banquet'] },
  { time: '18:00', en: 'Cocktail reception; welcome guests', zh: '迎賓及招待入席', scopes: ['banquet'] },
  { time: '19:30', en: 'Guests seated; banquet begins', zh: '賓客入席，婚宴開始', scopes: ['banquet'] },
  { time: '20:00', en: 'Grand entrance of the couple', zh: '新人進場', scopes: ['banquet'] },
  { time: '20:30', en: 'Cake cutting and champagne toast', zh: '切結婚蛋糕及祝酒', scopes: ['banquet'] },
  { time: '21:00', en: 'Table-to-table toasting', zh: '逐圍敬酒', scopes: ['banquet'] },
  { time: '22:30', en: 'Farewell to guests', zh: '送客' },
];

/** Scope flags stored on the wedding page (lect.scope_<key> = 'yes'). */
export function scopesFromLect(lect: Record<string, unknown>): Set<ScopeKey> {
  const selected = new Set<ScopeKey>();
  for (const key of SCOPE_KEYS) {
    if (String(lect[`scope_${key}`] ?? '').trim().toLowerCase() === 'yes') selected.add(key);
  }
  return selected;
}

/** An entry applies when it has no scope restriction or any selected scope matches. */
export function appliesToScopes<T extends { scopes?: ScopeKey[] }>(entry: T, selected: Set<ScopeKey>): boolean {
  if (!entry.scopes?.length) return true;
  return entry.scopes.some((scope) => selected.has(scope));
}
