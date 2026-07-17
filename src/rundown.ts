// Wedding-day rundown: a time-ordered run sheet with one-click generation from
// the scope-filtered template catalog, plus item CRUD. Mirrors the WeVow
// 製作Rundown feature. Rows order by time (blank times last), so reordering is
// done by editing times rather than dragging.

import {
  ADMIN_BASE,
  CmsClient,
  attr,
  compareByWeightThenName,
  listByWedding,
  type CmsPage,
} from './cms';
import { adminView } from './templates/views';
import { redirect } from '@lionrockjs/worker-cms-plugin';
import {
  formText,
  seedRundown,
  weddingContext,
  weddingHeader,
  withFlash,
} from './wedding';
import type { WeddingAdminAccess } from './permissions';

function compareByTime(a: CmsPage, b: CmsPage): number {
  const timeA = attr(a.lect, 'time');
  const timeB = attr(b.lect, 'time');
  if (timeA && timeB) return timeA.localeCompare(timeB) || compareByWeightThenName(a, b);
  if (timeA) return -1;
  if (timeB) return 1;
  return compareByWeightThenName(a, b);
}

export async function rundownView(
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

  const items = (await listByWedding(cms, 'rundown_item', weddingId)).sort(compareByTime);
  const base = `${ADMIN_BASE}/weddings/${weddingId}/rundown`;

  return adminView(views, `Rundown — ${ctx.wedding.name}`, 'rundown', {
    ...weddingHeader(ctx),
    flash: url.searchParams.get('flash') ?? '',
    canEdit,
    isEmpty: items.length === 0,
    generateAction: canEdit && items.length === 0 ? `${base}/generate` : '',
    newHref: canEdit ? `${base}/new` : '',
    items: items.map((item) => ({
      id: item.id,
      time: attr(item.lect, 'time'),
      name: item.name,
      owner: attr(item.lect, 'owner'),
      notes: attr(item.lect, 'notes'),
      editHref: canEdit ? `${base}/${item.id}` : '',
      deleteAction: canEdit ? `${base}/${item.id}/delete` : '',
    })),
  }, jsonOnly);
}

/** One-click rundown generation (only offered while the rundown is empty). */
export async function generateRundown(cms: CmsClient, weddingId: number): Promise<Response> {
  const ctx = await weddingContext(cms, weddingId);
  if (!ctx) return new Response('not found', { status: 404 });
  const existing = await listByWedding(cms, 'rundown_item', weddingId);
  if (existing.length === 0) {
    await seedRundown(cms, weddingId, ctx.scopes, ctx.language);
  }
  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/rundown`, 'wedding_planner.flash.rundown_generated'));
}

// ── Rundown item form (new / edit) ────────────────────────────────────────────

export async function rundownItemForm(
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
    if (item.page_type !== 'rundown_item') return new Response('not found', { status: 404 });
  }

  const base = `${ADMIN_BASE}/weddings/${weddingId}/rundown`;
  return adminView(views, item ? `Edit rundown item — ${item.name}` : 'New rundown item', 'rundown-item-form', {
    ...weddingHeader(ctx),
    isNew: !item,
    action: item ? `${base}/${item.id}` : `${base}/new`,
    backHref: base,
    deleteAction: item ? `${base}/${item.id}/delete` : '',
    name: item?.name ?? '',
    time: item ? attr(item.lect, 'time') : '',
    owner: item ? attr(item.lect, 'owner') : '',
    notes: item ? attr(item.lect, 'notes') : '',
  }, jsonOnly);
}

export async function createRundownItem(request: Request, cms: CmsClient, weddingId: number): Promise<Response> {
  const wedding = await cms.get(weddingId);
  if (wedding.page_type !== 'wedding') return new Response('not found', { status: 404 });
  const form = await request.formData();
  const name = formText(form, 'name');
  if (!name) return redirect(`${ADMIN_BASE}/weddings/${weddingId}/rundown/new`);

  await cms.create({
    page_type: 'rundown_item',
    name,
    slug: `rundown-${crypto.randomUUID()}`,
    weight: 10_000,
    lect: {
      _type: 'rundown_item',
      name: { en: name },
      time: normalizeTime(formText(form, 'time')),
      owner: formText(form, 'owner'),
      notes: formText(form, 'notes'),
      _pointers: { wedding: String(weddingId) },
    },
  });

  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/rundown`, 'wedding_planner.flash.rundown_item_created'));
}

export async function updateRundownItem(request: Request, cms: CmsClient, weddingId: number, itemId: number): Promise<Response> {
  const item = await cms.get(itemId);
  if (item.page_type !== 'rundown_item') return new Response('not found', { status: 404 });
  const form = await request.formData();
  const name = formText(form, 'name') || item.name;

  await cms.update(itemId, {
    name,
    lect: {
      name: { en: name },
      time: normalizeTime(formText(form, 'time')),
      owner: formText(form, 'owner'),
      notes: formText(form, 'notes'),
    },
  });

  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/rundown`, 'wedding_planner.flash.rundown_item_updated'));
}

export async function deleteRundownItem(cms: CmsClient, weddingId: number, itemId: number): Promise<Response> {
  const item = await cms.get(itemId);
  if (item.page_type !== 'rundown_item') return new Response('not found', { status: 404 });
  await cms.remove(itemId);
  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/rundown`, 'wedding_planner.flash.rundown_item_deleted'));
}

function normalizeTime(value: string): string {
  return /^\d{2}:\d{2}$/.test(value) ? value : '';
}
