// Budget tracker: category-grouped items with budget / paid / unpaid columns,
// overall totals with a spent-vs-remaining donut, an editable total wedding
// budget, and item CRUD. Mirrors the WeVow 婚禮預算.

import {
  ADMIN_BASE,
  CmsClient,
  attr,
  compareByWeightThenName,
  formatMoney,
  listByWedding,
  money,
  type CmsPage,
} from './cms';
import { CATEGORIES, categoryColor } from './catalog';
import { adminView } from './templates/views';
import { redirect } from '@lionrockjs/worker-cms-plugin';
import {
  categoryOptions,
  formMoney,
  formText,
  weddingContext,
  weddingHeader,
  withFlash,
} from './wedding';
import type { WeddingAdminAccess } from './permissions';

interface BudgetRow {
  id: number;
  name: string;
  budget: string;
  paid: string;
  unpaid: string;
  notes: string;
  editHref: string;
  deleteAction: string;
}

function budgetRow(item: CmsPage, weddingId: number, canEdit: boolean): BudgetRow {
  const base = `${ADMIN_BASE}/weddings/${weddingId}/budget/${item.id}`;
  const budget = money(item.lect, 'budget');
  const paid = money(item.lect, 'paid');
  return {
    id: item.id,
    name: item.name,
    budget: formatMoney(budget),
    paid: formatMoney(paid),
    unpaid: formatMoney(Math.max(0, budget - paid)),
    notes: attr(item.lect, 'notes'),
    editHref: canEdit ? base : '',
    deleteAction: canEdit ? `${base}/delete` : '',
  };
}

export async function budgetView(
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

  const items = await listByWedding(cms, 'budget_item', weddingId);
  const byCategory = new Map<string, CmsPage[]>();
  for (const item of items) {
    const category = attr(item.lect, 'category') || 'others';
    byCategory.set(category, [...(byCategory.get(category) ?? []), item]);
  }

  const groups = [...byCategory.entries()]
    .sort(([a], [b]) => categoryIndex(a) - categoryIndex(b))
    .map(([category, groupItems]) => {
      const budget = groupItems.reduce((sum, item) => sum + money(item.lect, 'budget'), 0);
      const paid = groupItems.reduce((sum, item) => sum + money(item.lect, 'paid'), 0);
      return {
        labelKey: `wedding_planner.categories.${category}`,
        color: categoryColor(category),
        budget: formatMoney(budget),
        paid: formatMoney(paid),
        unpaid: formatMoney(Math.max(0, budget - paid)),
        items: groupItems.sort(compareByWeightThenName).map((item) => budgetRow(item, weddingId, canEdit)),
      };
    });

  const itemBudget = items.reduce((sum, item) => sum + money(item.lect, 'budget'), 0);
  const explicitTotal = money(ctx.wedding.lect, 'budget_total');
  const totalBudget = explicitTotal || itemBudget;
  const totalPaid = items.reduce((sum, item) => sum + money(item.lect, 'paid'), 0);
  const spentPercent = totalBudget > 0 ? Math.min(100, Math.round((totalPaid / totalBudget) * 100)) : 0;

  // Donut geometry: r=54 → circumference ≈ 339.29, precomputed server-side so
  // the view stays free of arithmetic.
  const circumference = 2 * Math.PI * 54;

  return adminView(views, `Budget — ${ctx.wedding.name}`, 'budget', {
    ...weddingHeader(ctx),
    flash: url.searchParams.get('flash') ?? '',
    canEdit,
    newHref: canEdit ? `${ADMIN_BASE}/weddings/${weddingId}/budget/new` : '',
    totalAction: canEdit ? `${ADMIN_BASE}/weddings/${weddingId}/budget/total` : '',
    totalBudgetRaw: explicitTotal > 0 ? String(explicitTotal) : '',
    totalBudget: formatMoney(totalBudget),
    totalPaid: formatMoney(totalPaid),
    totalRemaining: formatMoney(Math.max(0, totalBudget - totalPaid)),
    totalUnpaid: formatMoney(Math.max(0, itemBudget - totalPaid)),
    spentPercent,
    donutDash: `${((spentPercent / 100) * circumference).toFixed(2)} ${circumference.toFixed(2)}`,
    groups,
  }, jsonOnly);
}

function categoryIndex(key: string): number {
  const index = CATEGORIES.findIndex((category) => category.key === key);
  return index === -1 ? CATEGORIES.length : index;
}

// ── Total wedding budget ──────────────────────────────────────────────────────

export async function updateBudgetTotal(request: Request, cms: CmsClient, weddingId: number): Promise<Response> {
  const wedding = await cms.get(weddingId);
  if (wedding.page_type !== 'wedding') return new Response('not found', { status: 404 });
  const form = await request.formData();
  await cms.update(weddingId, { lect: { budget_total: formMoney(form, 'budget_total') } });
  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/budget`, 'wedding_planner.flash.budget_total_updated'));
}

// ── Budget item form (new / edit) ─────────────────────────────────────────────

export async function budgetItemForm(
  cms: CmsClient,
  views: Fetcher,
  weddingId: number,
  itemId: number | null,
  jsonOnly = false,
): Promise<Response> {
  const ctx = await weddingContext(cms, weddingId);
  if (!ctx) return new Response('not found', { status: 404 });

  let item: CmsPage | null = null;
  if (itemId) {
    item = await cms.get(itemId);
    if (item.page_type !== 'budget_item') return new Response('not found', { status: 404 });
  }

  const base = `${ADMIN_BASE}/weddings/${weddingId}/budget`;
  return adminView(views, item ? `Edit budget item — ${item.name}` : 'New budget item', 'budget-item-form', {
    ...weddingHeader(ctx),
    isNew: !item,
    action: item ? `${base}/${item.id}` : `${base}/new`,
    backHref: base,
    deleteAction: item ? `${base}/${item.id}/delete` : '',
    name: item?.name ?? '',
    budget: item ? attr(item.lect, 'budget') : '',
    paid: item ? attr(item.lect, 'paid') : '',
    notes: item ? attr(item.lect, 'notes') : '',
    categories: categoryOptions(item ? attr(item.lect, 'category') || 'others' : ''),
  }, jsonOnly);
}

export async function createBudgetItem(request: Request, cms: CmsClient, weddingId: number): Promise<Response> {
  const wedding = await cms.get(weddingId);
  if (wedding.page_type !== 'wedding') return new Response('not found', { status: 404 });
  const form = await request.formData();
  const name = formText(form, 'name');
  if (!name) return redirect(`${ADMIN_BASE}/weddings/${weddingId}/budget/new`);

  await cms.create({
    page_type: 'budget_item',
    name,
    slug: `budget-${crypto.randomUUID()}`,
    weight: 10_000,
    lect: {
      _type: 'budget_item',
      name: { en: name },
      category: formText(form, 'category') || 'others',
      budget: formMoney(form, 'budget'),
      paid: formMoney(form, 'paid'),
      notes: formText(form, 'notes'),
      _pointers: { wedding: String(weddingId) },
    },
  });

  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/budget`, 'wedding_planner.flash.budget_item_created'));
}

export async function updateBudgetItem(request: Request, cms: CmsClient, weddingId: number, itemId: number): Promise<Response> {
  const item = await cms.get(itemId);
  if (item.page_type !== 'budget_item') return new Response('not found', { status: 404 });
  const form = await request.formData();
  const name = formText(form, 'name') || item.name;

  await cms.update(itemId, {
    name,
    lect: {
      name: { en: name },
      category: formText(form, 'category') || 'others',
      budget: formMoney(form, 'budget'),
      paid: formMoney(form, 'paid'),
      notes: formText(form, 'notes'),
    },
  });

  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/budget`, 'wedding_planner.flash.budget_item_updated'));
}

export async function deleteBudgetItem(cms: CmsClient, weddingId: number, itemId: number): Promise<Response> {
  const item = await cms.get(itemId);
  if (item.page_type !== 'budget_item') return new Response('not found', { status: 404 });
  await cms.remove(itemId);
  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/budget`, 'wedding_planner.flash.budget_item_deleted'));
}
