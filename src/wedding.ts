// Weddings: list, onboarding form (couple + date + scope questionnaire),
// create with checklist/budget seeding, dashboard, and cascade delete.

import {
  ADMIN_BASE,
  CmsClient,
  attr,
  chargeCreditAction,
  compareByWeightThenName,
  daysUntil,
  formatMoney,
  isYes,
  listByWedding,
  localized,
  money,
  monthLabel,
  monthMinus,
  weddingDate,
  type CmsPage,
  type CmsPageInput,
} from './cms';
import {
  BUDGET_TEMPLATES,
  CATEGORIES,
  RUNDOWN_TEMPLATES,
  SCOPE_KEYS,
  TASK_TEMPLATES,
  appliesToScopes,
  categoryColor,
  scopesFromLect,
  type ScopeKey,
} from './catalog';
import { adminView } from './templates/views';
import { redirect } from '@lionrockjs/worker-cms-plugin';
import type { WeddingAdminAccess } from './permissions';

export type SeedLanguage = 'en' | 'zh';

export function seedName(entry: { en: string; zh: string }, language: SeedLanguage): string {
  return language === 'zh' ? entry.zh : entry.en;
}

export function withFlash(path: string, message: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}flash=${encodeURIComponent(message)}`;
}

/**
 * Edit link into the CMS page editor that carries a `return_to` so the editor's
 * back arrow / Cancel button return to this plugin instead of the CMS home.
 */
export function editHrefReturningTo(pageId: number | string, returnTo: string): string {
  return `/admin/pages/${pageId}/edit?return_to=${encodeURIComponent(returnTo)}`;
}

function scopeOptions(selected?: Set<ScopeKey>): Array<{ key: string; labelKey: string; checked: boolean }> {
  return SCOPE_KEYS.map((key) => ({
    key,
    labelKey: `wedding_planner.scopes.${key}`,
    checked: selected?.has(key) ?? false,
  }));
}

export function categoryOptions(selected = ''): Array<{ key: string; labelKey: string; color: string; selected: boolean }> {
  return CATEGORIES.map((category) => ({
    key: category.key,
    labelKey: `wedding_planner.categories.${category.key}`,
    color: category.color,
    selected: category.key === selected,
  }));
}

// ── Weddings list ─────────────────────────────────────────────────────────────

export async function weddingsList(cms: CmsClient, views: Fetcher, url: URL, jsonOnly = false, access?: WeddingAdminAccess): Promise<Response> {
  const canEdit = access?.canEdit ?? true;
  const canDelete = access?.canDelete ?? true;
  const weddings = await cms.listAll('wedding');
  weddings.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.id - b.id);
  return adminView(views, 'Weddings', 'weddings', {
    flash: url.searchParams.get('flash') ?? '',
    canEdit,
    newHref: canEdit ? `${ADMIN_BASE}/weddings/new` : '',
    weddings: weddings.map((wedding) => {
      const date = weddingDate(wedding);
      const days = daysUntil(date);
      return {
        name: wedding.name,
        date,
        daysToGo: days !== null && days >= 0 ? days : null,
        dashboardHref: `${ADMIN_BASE}/weddings/${wedding.id}`,
        deleteHref: canDelete ? `${ADMIN_BASE}/weddings/${wedding.id}/delete` : '',
      };
    }),
  }, jsonOnly);
}

// ── New wedding (onboarding) ──────────────────────────────────────────────────

export async function newWeddingForm(cms: CmsClient, views: Fetcher, jsonOnly = false): Promise<Response> {
  return adminView(views, 'New wedding', 'wedding-new', {
    action: `${ADMIN_BASE}/weddings/new`,
    backHref: `${ADMIN_BASE}/weddings`,
    scopes: scopeOptions(),
    languages: [
      { value: 'en', labelKey: 'wedding_planner.views.wedding_new.language_en', selected: true },
      { value: 'zh', labelKey: 'wedding_planner.views.wedding_new.language_zh', selected: false },
    ],
  }, jsonOnly);
}

export async function createWeddingFromForm(request: Request, cms: CmsClient): Promise<Response> {
  const form = await request.formData();
  const partner1 = formText(form, 'partner1');
  const partner2 = formText(form, 'partner2');
  const date = formText(form, 'date');
  if (!partner1 || !partner2 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return redirect(`${ADMIN_BASE}/weddings/new`);
  }
  const language: SeedLanguage = formText(form, 'language') === 'zh' ? 'zh' : 'en';
  const seed = form.get('seed') !== null;
  const budgetTotal = money({ budget_total: formText(form, 'budget_total') }, 'budget_total');

  const scopes = new Set<ScopeKey>();
  for (const key of SCOPE_KEYS) {
    if (form.get(`scope_${key}`) !== null) scopes.add(key);
  }

  const name = `${partner1} & ${partner2}`;
  const lect: Record<string, unknown> = {
    _type: 'wedding',
    name: { en: name },
    partner1,
    partner2,
    checklist_language: language,
    budget_total: budgetTotal > 0 ? String(budgetTotal) : '',
  };
  for (const key of SCOPE_KEYS) lect[`scope_${key}`] = scopes.has(key) ? 'yes' : '';

  const wedding = await cms.create({
    page_type: 'wedding',
    name,
    slug: `wedding-${crypto.randomUUID()}`,
    start: `${date}T00:00`,
    timezone: '+0800',
    lect,
  });

  if (seed) {
    await seedChecklist(cms, wedding.id, date, scopes, language);
    await seedBudget(cms, wedding.id, scopes, language);
  }

  return redirect(withFlash(`${ADMIN_BASE}/weddings/${wedding.id}`, 'wedding_planner.flash.wedding_created'));
}

/** Seeds the countdown checklist from the template catalog, filtered by scope. */
export async function seedChecklist(
  cms: CmsClient,
  weddingId: number,
  date: string,
  scopes: Set<ScopeKey>,
  language: SeedLanguage,
): Promise<number> {
  const tasks = TASK_TEMPLATES.filter((template) => appliesToScopes(template, scopes));
  const inputs: CmsPageInput[] = tasks.map((template, index) => ({
    page_type: 'wedding_task',
    name: seedName(template, language),
    slug: `task-${crypto.randomUUID()}`,
    weight: index * 10,
    lect: {
      _type: 'wedding_task',
      name: { en: seedName(template, language) },
      category: template.category,
      due: monthMinus(date, template.offset),
      done: '',
      _pointers: { wedding: String(weddingId) },
    },
  }));
  await batchCreateAll(cms, inputs);
  return inputs.length;
}

/** Seeds the preset budget breakdown from the template catalog, filtered by scope. */
export async function seedBudget(
  cms: CmsClient,
  weddingId: number,
  scopes: Set<ScopeKey>,
  language: SeedLanguage,
): Promise<number> {
  const entries = BUDGET_TEMPLATES.filter((template) => appliesToScopes(template, scopes));
  const inputs: CmsPageInput[] = entries.map((template, index) => ({
    page_type: 'budget_item',
    name: seedName(template, language),
    slug: `budget-${crypto.randomUUID()}`,
    weight: index * 10,
    lect: {
      _type: 'budget_item',
      name: { en: seedName(template, language) },
      category: template.category,
      budget: String(template.budget),
      paid: '',
      _pointers: { wedding: String(weddingId) },
    },
  }));
  await batchCreateAll(cms, inputs);
  return inputs.length;
}

/** Generates the wedding-day rundown from the template catalog, filtered by scope. */
export async function seedRundown(
  cms: CmsClient,
  weddingId: number,
  scopes: Set<ScopeKey>,
  language: SeedLanguage,
): Promise<number> {
  const entries = RUNDOWN_TEMPLATES.filter((template) => appliesToScopes(template, scopes));
  const inputs: CmsPageInput[] = entries.map((template, index) => ({
    page_type: 'rundown_item',
    name: seedName(template, language),
    slug: `rundown-${crypto.randomUUID()}`,
    weight: index * 10,
    lect: {
      _type: 'rundown_item',
      name: { en: seedName(template, language) },
      time: template.time,
      _pointers: { wedding: String(weddingId) },
    },
  }));
  await batchCreateAll(cms, inputs);
  return inputs.length;
}

/** Creates pages through the batch endpoint in host-friendly chunks. */
async function batchCreateAll(cms: CmsClient, inputs: CmsPageInput[], chunkSize = 50): Promise<void> {
  for (let index = 0; index < inputs.length; index += chunkSize) {
    const chunk = inputs.slice(index, index + chunkSize);
    const result = await cms.batchCreate(chunk);
    if (result.errors.length) {
      const first = result.errors[0];
      throw new Error(`Seeding failed at item ${first.index}: ${first.error}`);
    }
  }
}

// ── Wedding context shared by the feature views ───────────────────────────────

export interface WeddingContext {
  wedding: CmsPage;
  date: string;
  daysToGo: number | null;
  scopes: Set<ScopeKey>;
  language: SeedLanguage;
}

export async function weddingContext(cms: CmsClient, weddingId: number): Promise<WeddingContext | null> {
  const wedding = await cms.get(weddingId);
  if (wedding.page_type !== 'wedding') return null;
  const date = weddingDate(wedding);
  return {
    wedding,
    date,
    daysToGo: daysUntil(date),
    scopes: scopesFromLect(wedding.lect),
    language: attr(wedding.lect, 'checklist_language') === 'zh' ? 'zh' : 'en',
  };
}

/** Header block shared by dashboard / checklist / budget / rundown views. */
export function weddingHeader(ctx: WeddingContext): Record<string, unknown> {
  return {
    weddingName: ctx.wedding.name,
    weddingDate: ctx.date,
    daysToGo: ctx.daysToGo !== null && ctx.daysToGo >= 0 ? ctx.daysToGo : null,
    weddingHref: `${ADMIN_BASE}/weddings/${ctx.wedding.id}`,
    checklistHref: `${ADMIN_BASE}/weddings/${ctx.wedding.id}/checklist`,
    budgetHref: `${ADMIN_BASE}/weddings/${ctx.wedding.id}/budget`,
    rundownHref: `${ADMIN_BASE}/weddings/${ctx.wedding.id}/rundown`,
    weddingsHref: `${ADMIN_BASE}/weddings`,
  };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function weddingDashboard(
  cms: CmsClient,
  views: Fetcher,
  weddingId: number,
  url: URL,
  jsonOnly = false,
  access?: WeddingAdminAccess,
): Promise<Response> {
  const ctx = await weddingContext(cms, weddingId);
  if (!ctx) return new Response('not found', { status: 404 });
  const canEdit = access?.canEdit ?? true;

  const [tasks, budgetItems, rundownItems] = await Promise.all([
    listByWedding(cms, 'wedding_task', weddingId),
    listByWedding(cms, 'budget_item', weddingId),
    listByWedding(cms, 'rundown_item', weddingId),
  ]);

  const doneCount = tasks.filter((task) => isYes(task.lect, 'done')).length;
  const totalBudget = money(ctx.wedding.lect, 'budget_total')
    || budgetItems.reduce((sum, item) => sum + money(item.lect, 'budget'), 0);
  const totalPaid = budgetItems.reduce((sum, item) => sum + money(item.lect, 'paid'), 0);

  // The next incomplete tasks, soonest month first (mirrors the WeVow home card).
  const upcoming = tasks
    .filter((task) => !isYes(task.lect, 'done'))
    .sort((a, b) => attr(a.lect, 'due').localeCompare(attr(b.lect, 'due')) || compareByWeightThenName(a, b))
    .slice(0, 6)
    .map((task) => ({
      name: task.name,
      dueLabel: monthLabel(attr(task.lect, 'due')),
      categoryLabelKey: `wedding_planner.categories.${attr(task.lect, 'category') || 'others'}`,
      categoryColor: categoryColor(attr(task.lect, 'category')),
    }));

  return adminView(views, ctx.wedding.name, 'wedding-dashboard', {
    ...weddingHeader(ctx),
    flash: url.searchParams.get('flash') ?? '',
    partner1: attr(ctx.wedding.lect, 'partner1') || localized(ctx.wedding.lect, 'name'),
    partner2: attr(ctx.wedding.lect, 'partner2'),
    editHref: canEdit ? editHrefReturningTo(weddingId, `${ADMIN_BASE}/weddings/${weddingId}`) : '',
    deleteHref: (access?.canDelete ?? true) ? `${ADMIN_BASE}/weddings/${weddingId}/delete` : '',
    taskDone: doneCount,
    taskTotal: tasks.length,
    taskPercent: tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0,
    budgetTotal: formatMoney(totalBudget),
    budgetPaid: formatMoney(totalPaid),
    budgetRemaining: formatMoney(Math.max(0, totalBudget - totalPaid)),
    budgetPercent: totalBudget > 0 ? Math.min(100, Math.round((totalPaid / totalBudget) * 100)) : 0,
    rundownCount: rundownItems.length,
    upcoming,
  }, jsonOnly);
}

// ── Delete wedding (cascade) ──────────────────────────────────────────────────

export async function deleteWeddingForm(cms: CmsClient, views: Fetcher, weddingId: number, jsonOnly = false): Promise<Response> {
  const ctx = await weddingContext(cms, weddingId);
  if (!ctx) return new Response('not found', { status: 404 });
  const [tasks, budgetItems, rundownItems] = await Promise.all([
    listByWedding(cms, 'wedding_task', weddingId),
    listByWedding(cms, 'budget_item', weddingId),
    listByWedding(cms, 'rundown_item', weddingId),
  ]);
  return adminView(views, `Delete — ${ctx.wedding.name}`, 'wedding-delete', {
    ...weddingHeader(ctx),
    action: `${ADMIN_BASE}/weddings/${weddingId}/delete`,
    taskCount: tasks.length,
    budgetCount: budgetItems.length,
    rundownCount: rundownItems.length,
  }, jsonOnly);
}

export async function deleteWedding(cms: CmsClient, weddingId: number): Promise<Response> {
  const wedding = await cms.get(weddingId);
  if (wedding.page_type !== 'wedding') return new Response('not found', { status: 404 });

  await chargeCreditAction(cms, 'delete_wedding', 1, {
    entityType: 'wedding',
    entityId: weddingId,
    note: 'Delete wedding cascade',
  });

  // Children reference their wedding by the `wedding` lect pointer, so the CMS
  // trashes them server-side; the collections are small (≤ a few hundred pages).
  const selector = { pointerKey: 'wedding', pointerValue: String(weddingId) } as const;
  await cms.deleteChildren(selector, 'wedding_task');
  await cms.deleteChildren(selector, 'budget_item');
  await cms.deleteChildren(selector, 'rundown_item');
  await cms.remove(weddingId);

  return redirect(withFlash(`${ADMIN_BASE}/weddings`, 'wedding_planner.flash.wedding_deleted'));
}

// ── Form field helpers shared by the feature modules ──────────────────────────

export function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function formMoney(form: FormData, key: string): string {
  const parsed = Number.parseFloat(formText(form, key).replace(/[,$\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : '';
}
