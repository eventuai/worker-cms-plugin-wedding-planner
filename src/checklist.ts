// Countdown checklist: month-grouped task timeline with per-month progress,
// category chips, filters (date/category view, done state), check-off toggle,
// drag reorder inside a month, and task CRUD. Mirrors the WeVow 倒數日程表.

import {
  ADMIN_BASE,
  CMS_BATCH_WEIGHT_ACTION,
  CmsClient,
  attr,
  compareByWeightThenName,
  isYes,
  listByWedding,
  monthLabel,
  type CmsPage,
} from './cms';
import { CATEGORIES, categoryColor } from './catalog';
import { adminView } from './templates/views';
import { redirect } from '@lionrockjs/worker-cms-plugin';
import {
  categoryOptions,
  formText,
  weddingContext,
  weddingHeader,
  withFlash,
  type WeddingContext,
} from './wedding';
import type { WeddingAdminAccess } from './permissions';

type StateFilter = 'all' | 'done' | 'todo';
type ViewMode = 'date' | 'category';

interface ChecklistFilters {
  view: ViewMode;
  state: StateFilter;
  category: string;
}

function filtersFromUrl(url: URL): ChecklistFilters {
  const view = url.searchParams.get('view') === 'category' ? 'category' : 'date';
  const stateParam = url.searchParams.get('state');
  const state: StateFilter = stateParam === 'done' || stateParam === 'todo' ? stateParam : 'all';
  return { view, state, category: url.searchParams.get('cat') ?? '' };
}

function checklistQuery(filters: ChecklistFilters): string {
  const params = new URLSearchParams();
  if (filters.view !== 'date') params.set('view', filters.view);
  if (filters.state !== 'all') params.set('state', filters.state);
  if (filters.category) params.set('cat', filters.category);
  const query = params.toString();
  return query ? `?${query}` : '';
}

function checklistHref(weddingId: number, filters: ChecklistFilters): string {
  return `${ADMIN_BASE}/weddings/${weddingId}/checklist${checklistQuery(filters)}`;
}

interface TaskRow {
  id: number;
  name: string;
  done: boolean;
  dueLabel: string;
  timeLabel: string;
  vendor: string;
  notes: string;
  categoryLabelKey: string;
  categoryColor: string;
  editHref: string;
  toggleAction: string;
  deleteAction: string;
}

function taskRow(task: CmsPage, weddingId: number, filters: ChecklistFilters, canEdit: boolean): TaskRow {
  const category = attr(task.lect, 'category') || 'others';
  const base = `${ADMIN_BASE}/weddings/${weddingId}/checklist/${task.id}`;
  const back = checklistQuery(filters);
  const dueDay = attr(task.lect, 'due_day');
  const due = attr(task.lect, 'due');
  return {
    id: task.id,
    name: task.name,
    done: isYes(task.lect, 'done'),
    dueLabel: dueDay ? `${monthLabel(due)} ${dueDay}` : monthLabel(due),
    timeLabel: attr(task.lect, 'time'),
    vendor: attr(task.lect, 'vendor'),
    notes: attr(task.lect, 'notes'),
    categoryLabelKey: `wedding_planner.categories.${category}`,
    categoryColor: categoryColor(category),
    editHref: canEdit ? `${base}${back}` : '',
    toggleAction: canEdit ? `${base}/toggle${back}` : '',
    deleteAction: canEdit ? `${base}/delete${back}` : '',
  };
}

export async function checklistView(
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
  const filters = filtersFromUrl(url);

  const tasks = await listByWedding(cms, 'wedding_task', weddingId);
  const visible = tasks.filter((task) => {
    if (filters.state === 'done' && !isYes(task.lect, 'done')) return false;
    if (filters.state === 'todo' && isYes(task.lect, 'done')) return false;
    if (filters.category && (attr(task.lect, 'category') || 'others') !== filters.category) return false;
    return true;
  });

  const groups = filters.view === 'category'
    ? groupByCategory(visible)
    : groupByMonth(visible);

  const doneCount = tasks.filter((task) => isYes(task.lect, 'done')).length;

  return adminView(views, `Checklist — ${ctx.wedding.name}`, 'checklist', {
    ...weddingHeader(ctx),
    flash: url.searchParams.get('flash') ?? '',
    canEdit,
    newHref: canEdit ? `${ADMIN_BASE}/weddings/${weddingId}/checklist/new${checklistQuery(filters)}` : '',
    reorderAction: canEdit && filters.view === 'date' ? CMS_BATCH_WEIGHT_ACTION : '',
    taskDone: doneCount,
    taskTotal: tasks.length,
    viewMode: filters.view,
    stateFilter: filters.state,
    categoryFilter: filters.category,
    viewDateHref: checklistHref(weddingId, { ...filters, view: 'date' }),
    viewCategoryHref: checklistHref(weddingId, { ...filters, view: 'category' }),
    stateHrefs: {
      all: checklistHref(weddingId, { ...filters, state: 'all' }),
      todo: checklistHref(weddingId, { ...filters, state: 'todo' }),
      done: checklistHref(weddingId, { ...filters, state: 'done' }),
    },
    categoryFilters: [
      { key: '', labelKey: 'wedding_planner.views.checklist.all_categories', color: '', selected: !filters.category, href: checklistHref(weddingId, { ...filters, category: '' }) },
      ...categoryOptions(filters.category).map((option) => ({
        ...option,
        href: checklistHref(weddingId, { ...filters, category: option.key }),
      })),
    ],
    groups: groups.map((group) => ({
      ...group,
      tasks: group.tasks.map((task) => taskRow(task, weddingId, filters, canEdit)),
    })),
  }, jsonOnly);
}

interface TaskGroup {
  label: string;
  labelKey: string;
  done: number;
  total: number;
  tasks: CmsPage[];
}

/** Months ascending; undated tasks last. Mirrors the WeVow month timeline. */
function groupByMonth(tasks: CmsPage[]): TaskGroup[] {
  const byMonth = new Map<string, CmsPage[]>();
  for (const task of tasks) {
    const month = attr(task.lect, 'due');
    byMonth.set(month, [...(byMonth.get(month) ?? []), task]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([month, groupTasks]) => ({
      label: month ? monthLabel(month) : '',
      labelKey: month ? '' : 'wedding_planner.views.checklist.no_due_month',
      done: groupTasks.filter((task) => isYes(task.lect, 'done')).length,
      total: groupTasks.length,
      tasks: groupTasks.sort(compareByWeightThenName),
    }));
}

/** Catalog category order, then due month inside each category. */
function groupByCategory(tasks: CmsPage[]): TaskGroup[] {
  const byCategory = new Map<string, CmsPage[]>();
  for (const task of tasks) {
    const category = attr(task.lect, 'category') || 'others';
    byCategory.set(category, [...(byCategory.get(category) ?? []), task]);
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => categoryIndex(a) - categoryIndex(b))
    .map(([category, groupTasks]) => ({
      label: '',
      labelKey: `wedding_planner.categories.${category}`,
      done: groupTasks.filter((task) => isYes(task.lect, 'done')).length,
      total: groupTasks.length,
      tasks: groupTasks.sort((a, b) => attr(a.lect, 'due').localeCompare(attr(b.lect, 'due')) || compareByWeightThenName(a, b)),
    }));
}

function categoryIndex(key: string): number {
  const index = CATEGORIES.findIndex((category) => category.key === key);
  return index === -1 ? CATEGORIES.length : index;
}

// ── Task form (new / edit) ────────────────────────────────────────────────────

export async function taskForm(
  cms: CmsClient,
  views: Fetcher,
  ctxOrWeddingId: WeddingContext | number,
  taskId: number | null,
  url: URL,
  jsonOnly = false,
): Promise<Response> {
  const ctx = typeof ctxOrWeddingId === 'number' ? await weddingContext(cms, ctxOrWeddingId) : ctxOrWeddingId;
  if (!ctx) return new Response('not found', { status: 404 });
  const weddingId = ctx.wedding.id;

  let task: CmsPage | null = null;
  if (taskId) {
    task = await cms.get(taskId);
    if (task.page_type !== 'wedding_task') return new Response('not found', { status: 404 });
  }

  const back = url.search;
  const base = `${ADMIN_BASE}/weddings/${weddingId}/checklist`;
  return adminView(views, task ? `Edit task — ${task.name}` : 'New task', 'task-form', {
    ...weddingHeader(ctx),
    isNew: !task,
    action: task ? `${base}/${task.id}${back}` : `${base}/new${back}`,
    backHref: `${base}${back}`,
    deleteAction: task ? `${base}/${task.id}/delete${back}` : '',
    name: task?.name ?? '',
    due: task ? attr(task.lect, 'due') : '',
    dueDay: task ? attr(task.lect, 'due_day') : '',
    time: task ? attr(task.lect, 'time') : '',
    vendor: task ? attr(task.lect, 'vendor') : '',
    notes: task ? attr(task.lect, 'notes') : '',
    done: task ? isYes(task.lect, 'done') : false,
    categories: categoryOptions(task ? attr(task.lect, 'category') || 'others' : ''),
  }, jsonOnly);
}

export async function createTask(request: Request, cms: CmsClient, weddingId: number, url: URL): Promise<Response> {
  const wedding = await cms.get(weddingId);
  if (wedding.page_type !== 'wedding') return new Response('not found', { status: 404 });
  const form = await request.formData();
  const name = formText(form, 'name');
  const back = url.search;
  if (!name) return redirect(`${ADMIN_BASE}/weddings/${weddingId}/checklist/new${back}`);

  await cms.create({
    page_type: 'wedding_task',
    name,
    slug: `task-${crypto.randomUUID()}`,
    // New tasks sort after the seeded ones inside their month.
    weight: 10_000,
    lect: {
      _type: 'wedding_task',
      name: { en: name },
      category: formText(form, 'category') || 'others',
      due: normalizeMonth(formText(form, 'due')),
      due_day: normalizeDay(formText(form, 'due_day')),
      time: formText(form, 'time'),
      vendor: formText(form, 'vendor'),
      notes: formText(form, 'notes'),
      done: form.get('done') !== null ? 'yes' : '',
      _pointers: { wedding: String(weddingId) },
    },
  });

  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/checklist${back}`, 'wedding_planner.flash.task_created'));
}

export async function updateTask(request: Request, cms: CmsClient, weddingId: number, taskId: number, url: URL): Promise<Response> {
  const task = await cms.get(taskId);
  if (task.page_type !== 'wedding_task') return new Response('not found', { status: 404 });
  const form = await request.formData();
  const name = formText(form, 'name') || task.name;
  const back = url.search;

  await cms.update(taskId, {
    name,
    lect: {
      name: { en: name },
      category: formText(form, 'category') || 'others',
      due: normalizeMonth(formText(form, 'due')),
      due_day: normalizeDay(formText(form, 'due_day')),
      time: formText(form, 'time'),
      vendor: formText(form, 'vendor'),
      notes: formText(form, 'notes'),
      done: form.get('done') !== null ? 'yes' : '',
    },
  });

  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/checklist${back}`, 'wedding_planner.flash.task_updated'));
}

export async function toggleTask(cms: CmsClient, weddingId: number, taskId: number, url: URL): Promise<Response> {
  const task = await cms.get(taskId);
  if (task.page_type !== 'wedding_task') return new Response('not found', { status: 404 });
  await cms.update(taskId, { lect: { done: isYes(task.lect, 'done') ? '' : 'yes' } });
  return redirect(`${ADMIN_BASE}/weddings/${weddingId}/checklist${url.search}`);
}

export async function deleteTask(cms: CmsClient, weddingId: number, taskId: number, url: URL): Promise<Response> {
  const task = await cms.get(taskId);
  if (task.page_type !== 'wedding_task') return new Response('not found', { status: 404 });
  await cms.remove(taskId);
  return redirect(withFlash(`${ADMIN_BASE}/weddings/${weddingId}/checklist${url.search}`, 'wedding_planner.flash.task_deleted'));
}

function normalizeMonth(value: string): string {
  return /^\d{4}-\d{2}$/.test(value) ? value : '';
}

function normalizeDay(value: string): string {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 31 ? String(parsed) : '';
}
