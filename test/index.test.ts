import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearTenantCache } from '@lionrockjs/worker-cms-plugin';
import worker from '../src/index';
import { renderView } from '../src/templates/liquid';
import { daysUntil, monthMinus } from '../src/cms';

interface PluginEnv {
  CMS_URL?: string;
  PLUGIN_SECRET?: string;
  VIEWS: Fetcher;
}

const plugin = worker as {
  fetch(request: Request, env: PluginEnv): Promise<Response>;
};

const SECRET = 'shared-secret';

function views(): Fetcher {
  return {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const url = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url);
      try {
        return new Response(await readFile(fileURLToPath(new URL(`../views${url.pathname}`, import.meta.url).href), 'utf8'));
      } catch {
        return new Response('not found', { status: 404 });
      }
    },
  } as Fetcher;
}

function env(): PluginEnv {
  return { VIEWS: views(), CMS_URL: 'https://cms.test', PLUGIN_SECRET: SECRET };
}

async function renderedText(response: Response): Promise<string> {
  if (response.headers.get('x-cms-client-view') !== '1') return response.text();
  const viewPath = response.headers.get('x-cms-view-path');
  if (!viewPath) throw new Error('Missing x-cms-view-path');
  const data = await response.clone().json() as Record<string, unknown>;
  return renderView(views(), viewPath, data);
}

function adminRequest(path: string, init: RequestInit = {}, user?: string): Request {
  const headers = new Headers(init.headers);
  headers.set('x-plugin-secret', SECRET);
  if (user) headers.set('x-cms-user', user);
  return new Request(`https://wedding.test${path}`, { ...init, headers });
}

function form(fields: Record<string, string>): RequestInit {
  const body = new URLSearchParams(fields);
  return {
    method: 'POST',
    body: body.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
}

interface StoredPage {
  id: number;
  uuid: string;
  page_type: string;
  name: string;
  slug: string;
  weight: number;
  start: string | null;
  end: string | null;
  timezone: string | null;
  page_id: number | null;
  created_at: string;
  updated_at: string;
  lect: Record<string, unknown>;
}

/** In-memory stand-in for the host's /__cms Plugin API. */
function cmsStub() {
  const pages = new Map<number, StoredPage>();
  let nextId = 1;
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];

  function insert(input: Partial<StoredPage>): StoredPage {
    const page: StoredPage = {
      id: nextId++,
      uuid: crypto.randomUUID(),
      page_type: input.page_type ?? '',
      name: input.name ?? '',
      slug: input.slug ?? `page-${nextId}`,
      weight: input.weight ?? 5,
      start: input.start ?? null,
      end: input.end ?? null,
      timezone: input.timezone ?? null,
      page_id: input.page_id ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      lect: input.lect ?? {},
    };
    pages.set(page.id, page);
    return page;
  }

  function pointerOf(page: StoredPage, key: string): string {
    const pointers = page.lect._pointers;
    if (pointers && typeof pointers === 'object') return String((pointers as Record<string, unknown>)[key] ?? '');
    return '';
  }

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });

    if (url.pathname === '/__cms/pages' && method === 'GET') {
      const type = url.searchParams.get('page_type') ?? '';
      const pointerKey = url.searchParams.get('pointer_key');
      const pointerValue = url.searchParams.get('pointer_value');
      const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);
      const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '500', 10), 500);
      let matched = [...pages.values()].filter((page) => page.page_type === type);
      if (pointerKey && pointerValue !== null) {
        matched = matched.filter((page) => pointerOf(page, pointerKey) === pointerValue);
      }
      return Response.json({ pages: matched.slice(offset, offset + limit), total: matched.length });
    }

    const idMatch = /^\/__cms\/pages\/(\d+)$/.exec(url.pathname);
    if (idMatch) {
      const id = Number(idMatch[1]);
      const page = pages.get(id);
      if (!page) return Response.json({ error: 'not_found' }, { status: 404 });
      if (method === 'GET') return Response.json({ page });
      if (method === 'PUT') {
        // Mirrors the host's partial merge: lect merges over stored, name kept when omitted.
        if (body.lect) page.lect = { ...page.lect, ...body.lect };
        if (body.name !== undefined) page.name = body.name;
        if (body.start !== undefined) page.start = body.start;
        page.updated_at = new Date().toISOString();
        return Response.json({ page });
      }
      if (method === 'DELETE') {
        pages.delete(id);
        return Response.json({ success: true });
      }
    }

    if (url.pathname === '/__cms/pages' && method === 'POST') {
      return Response.json({ page: insert(body) });
    }

    if (url.pathname === '/__cms/pages/batch' && method === 'POST') {
      const created = (body.pages as Partial<StoredPage>[]).map((input) => insert(input));
      return Response.json({ created, errors: [] });
    }

    if (url.pathname === '/__cms/pages/children' && method === 'DELETE') {
      const key = body.pointer_key as string;
      const value = body.pointer_value as string;
      const type = body.page_type as string;
      let trashed = 0;
      for (const [id, page] of [...pages.entries()]) {
        if (page.page_type === type && pointerOf(page, key) === value) {
          pages.delete(id);
          trashed += 1;
        }
      }
      return Response.json({ trashed, done: true });
    }

    if (url.pathname === '/__cms/credits/charge' && method === 'POST') {
      return Response.json({ charged: 0, balance: null });
    }

    return Response.json({ error: 'unexpected_call' }, { status: 500 });
  });

  return { pages, insert, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearTenantCache();
});

describe('plugin contract', () => {
  it('exposes the wedding-planner manifest without a secret', async () => {
    const response = await plugin.fetch(new Request('https://wedding.test/__plugin/manifest'), env());
    expect(response.status).toBe(200);
    const manifest = await response.json() as Record<string, unknown>;
    expect(manifest).toMatchObject({
      id: 'wedding-planner',
      nav: [{ label: 'Weddings', href: 'weddings', roles: ['admin', 'editor', 'moderator'] }],
      permissions: [
        { value: 'wedding-planner:view', label: 'Wedding planner: view weddings, checklists, budgets and rundowns' },
        { value: 'wedding-planner:write', label: 'Wedding planner: create and edit weddings, checklists, budgets and rundowns' },
      ],
    });
    const blueprint = (manifest.contentTypes as { blueprint: Record<string, unknown> }).blueprint;
    expect(Object.keys(blueprint)).toEqual(['wedding', 'wedding_task', 'budget_item', 'rundown_item']);
  });

  it('rejects admin calls without the plugin secret', async () => {
    cmsStub();
    const response = await plugin.fetch(new Request('https://wedding.test/__plugin/admin/weddings'), env());
    expect(response.status).toBe(403);
  });

  it('forbids users without wedding-planner permissions', async () => {
    cmsStub();
    const user = JSON.stringify({ id: '7', role: 'author', permissions: [] });
    const response = await plugin.fetch(adminRequest('/__plugin/admin/weddings', {}, user), env());
    expect(response.status).toBe(403);
  });
});

describe('date helpers', () => {
  it('computes months before the wedding month', () => {
    expect(monthMinus('2027-05-15', 0)).toBe('2027-05');
    expect(monthMinus('2027-05-15', 9)).toBe('2026-08');
    expect(monthMinus('2027-05-15', 12)).toBe('2026-05');
    expect(monthMinus('2027-01-01', 3)).toBe('2026-10');
  });

  it('computes whole days until the wedding', () => {
    expect(daysUntil('2027-05-15', new Date('2026-07-18T10:00:00Z'))).toBe(301);
    expect(daysUntil('', new Date())).toBeNull();
  });
});

describe('weddings', () => {
  it('renders an empty weddings list', async () => {
    cmsStub();
    const response = await plugin.fetch(adminRequest('/__plugin/admin/weddings'), env());
    expect(response.status).toBe(200);
    const html = await renderedText(response);
    expect(html).toContain('No weddings yet.');
  });

  it('creates a wedding and seeds a scope-filtered checklist and budget', async () => {
    const cms = cmsStub();
    const response = await plugin.fetch(adminRequest('/__plugin/admin/weddings/new', form({
      partner1: 'Miriam',
      partner2: 'Colin',
      date: '2027-05-15',
      language: 'zh',
      scope_banquet: 'yes',
      scope_church: 'yes',
      scope_honeymoon: 'yes',
      seed: 'yes',
      budget_total: '300000',
    })), env());

    expect(response.status).toBe(302);
    const weddings = [...cms.pages.values()].filter((page) => page.page_type === 'wedding');
    expect(weddings).toHaveLength(1);
    const wedding = weddings[0];
    expect(response.headers.get('location')).toContain(`/admin/plugins/wedding-planner/weddings/${wedding.id}`);
    expect(wedding.name).toBe('Miriam & Colin');
    expect(wedding.start).toBe('2027-05-15T00:00');
    expect(wedding.lect).toMatchObject({
      partner1: 'Miriam',
      partner2: 'Colin',
      scope_banquet: 'yes',
      scope_church: 'yes',
      scope_honeymoon: 'yes',
      scope_newhome: '',
      budget_total: '300000',
    });

    const tasks = [...cms.pages.values()].filter((page) => page.page_type === 'wedding_task');
    expect(tasks.length).toBeGreaterThan(30);
    // Chinese checklist names, seeded from the zh catalog.
    const photographer = tasks.find((task) => task.name === '預約婚禮攝影師及錄影師/公司');
    expect(photographer).toBeDefined();
    expect(photographer!.lect).toMatchObject({ category: 'bigday', due: '2026-08', done: '' });
    expect((photographer!.lect._pointers as Record<string, string>).wedding).toBe(String(wedding.id));
    // A banquet-scoped task seeds; a newhome-scoped one does not.
    expect(tasks.some((task) => task.name === '預約大妗姐')).toBe(true);
    expect(tasks.some((task) => task.name === '添置傢俬')).toBe(false);

    const budget = [...cms.pages.values()].filter((page) => page.page_type === 'budget_item');
    expect(budget.some((item) => item.name === '婚宴酒席' && item.lect.budget === '200000')).toBe(true);
    expect(budget.some((item) => item.name === '新居傢俬及裝修')).toBe(false);
  });

  it('shows the dashboard with checklist progress and countdown', async () => {
    const cms = cmsStub();
    const wedding = cms.insert({
      page_type: 'wedding',
      name: 'Miriam & Colin',
      start: '2099-05-15T00:00',
      lect: { _type: 'wedding', partner1: 'Miriam', partner2: 'Colin', budget_total: '100000' },
    });
    cms.insert({
      page_type: 'wedding_task',
      name: 'Book venue',
      lect: { category: 'venue', due: '2099-01', done: 'yes', _pointers: { wedding: String(wedding.id) } },
    });
    cms.insert({
      page_type: 'wedding_task',
      name: 'Collect gown',
      lect: { category: 'gown', due: '2099-05', done: '', _pointers: { wedding: String(wedding.id) } },
    });
    cms.insert({
      page_type: 'budget_item',
      name: 'Banquet',
      lect: { category: 'venue', budget: '80000', paid: '20000', _pointers: { wedding: String(wedding.id) } },
    });

    const response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}`), env());
    expect(response.status).toBe(200);
    const data = await response.clone().json() as Record<string, unknown>;
    expect(data.taskDone).toBe(1);
    expect(data.taskTotal).toBe(2);
    expect(data.budgetPaid).toBe('20,000');
    expect(data.budgetTotal).toBe('100,000');
    expect(data.daysToGo).toBeGreaterThan(0);
    const html = await renderedText(response);
    expect(html).toContain('Miriam &amp; Colin');
    expect(html).toContain('Collect gown');
  });

  it('cascade-deletes a wedding and its children', async () => {
    const cms = cmsStub();
    const wedding = cms.insert({ page_type: 'wedding', name: 'W', start: '2099-05-15T00:00', lect: {} });
    cms.insert({ page_type: 'wedding_task', name: 'T', lect: { _pointers: { wedding: String(wedding.id) } } });
    cms.insert({ page_type: 'budget_item', name: 'B', lect: { _pointers: { wedding: String(wedding.id) } } });
    cms.insert({ page_type: 'rundown_item', name: 'R', lect: { _pointers: { wedding: String(wedding.id) } } });

    const response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}/delete`, { method: 'POST' }), env());
    expect(response.status).toBe(302);
    expect(cms.pages.size).toBe(0);
  });
});

describe('checklist', () => {
  it('groups tasks by month and reports per-month progress', async () => {
    const cms = cmsStub();
    const wedding = cms.insert({ page_type: 'wedding', name: 'W', start: '2027-05-15T00:00', lect: {} });
    cms.insert({ page_type: 'wedding_task', name: 'August task', weight: 10, lect: { category: 'gown', due: '2026-08', done: 'yes', _pointers: { wedding: String(wedding.id) } } });
    cms.insert({ page_type: 'wedding_task', name: 'May task', weight: 20, lect: { category: 'bigday', due: '2027-05', done: '', _pointers: { wedding: String(wedding.id) } } });

    const response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}/checklist`), env());
    expect(response.status).toBe(200);
    const data = await response.clone().json() as { groups: Array<{ label: string; done: number; total: number }> };
    expect(data.groups.map((group) => group.label)).toEqual(['Aug 2026', 'May 2027']);
    expect(data.groups[0]).toMatchObject({ done: 1, total: 1 });
    const html = await renderedText(response);
    expect(html).toContain('August task');
    expect(html).toContain('data-reorder');
  });

  it('toggles a task done and back', async () => {
    const cms = cmsStub();
    const wedding = cms.insert({ page_type: 'wedding', name: 'W', start: '2027-05-15T00:00', lect: {} });
    const task = cms.insert({ page_type: 'wedding_task', name: 'T', lect: { done: '', _pointers: { wedding: String(wedding.id) } } });

    const toggle = () => plugin.fetch(
      adminRequest(`/__plugin/admin/weddings/${wedding.id}/checklist/${task.id}/toggle?state=todo`, { method: 'POST' }),
      env(),
    );
    let response = await toggle();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/admin/plugins/wedding-planner/weddings/${wedding.id}/checklist?state=todo`);
    expect(cms.pages.get(task.id)!.lect.done).toBe('yes');
    response = await toggle();
    expect(cms.pages.get(task.id)!.lect.done).toBe('');
  });

  it('creates a custom task from the form', async () => {
    const cms = cmsStub();
    const wedding = cms.insert({ page_type: 'wedding', name: 'W', start: '2027-05-15T00:00', lect: {} });
    const response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}/checklist/new`, form({
      name: 'Order flowers',
      category: 'bigday',
      due: '2027-04',
      due_day: '12',
      time: '10:30',
      vendor: 'Florist Co',
      notes: 'peonies',
    })), env());
    expect(response.status).toBe(302);
    const task = [...cms.pages.values()].find((page) => page.page_type === 'wedding_task');
    expect(task).toBeDefined();
    expect(task!.lect).toMatchObject({ category: 'bigday', due: '2027-04', due_day: '12', time: '10:30', vendor: 'Florist Co', notes: 'peonies', done: '' });
  });
});

describe('budget', () => {
  it('renders totals, category groups and the donut', async () => {
    const cms = cmsStub();
    const wedding = cms.insert({ page_type: 'wedding', name: 'W', start: '2027-05-15T00:00', lect: { budget_total: '200000' } });
    cms.insert({ page_type: 'budget_item', name: 'Banquet', lect: { category: 'venue', budget: '150000', paid: '50000', _pointers: { wedding: String(wedding.id) } } });
    cms.insert({ page_type: 'budget_item', name: 'Gown', lect: { category: 'gown', budget: '8000', paid: '', _pointers: { wedding: String(wedding.id) } } });

    const response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}/budget`), env());
    expect(response.status).toBe(200);
    const data = await response.clone().json() as Record<string, unknown>;
    expect(data.totalBudget).toBe('200,000');
    expect(data.totalPaid).toBe('50,000');
    expect(data.totalRemaining).toBe('150,000');
    expect(data.spentPercent).toBe(25);
    const html = await renderedText(response);
    expect(html).toContain('Banquet');
    expect(html).toContain('108,000'); // unpaid = (150000 + 8000) - 50000
  });

  it('creates and updates budget items and the total', async () => {
    const cms = cmsStub();
    const wedding = cms.insert({ page_type: 'wedding', name: 'W', start: '2027-05-15T00:00', lect: {} });

    let response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}/budget/new`, form({
      name: 'Photobooth',
      category: 'services',
      budget: '5000',
      paid: '1000',
    })), env());
    expect(response.status).toBe(302);
    const item = [...cms.pages.values()].find((page) => page.page_type === 'budget_item')!;
    expect(item.lect).toMatchObject({ category: 'services', budget: '5000', paid: '1000' });

    response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}/budget/${item.id}`, form({
      name: 'Photobooth',
      category: 'services',
      budget: '6000',
      paid: '6000',
    })), env());
    expect(response.status).toBe(302);
    expect(cms.pages.get(item.id)!.lect.budget).toBe('6000');

    response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}/budget/total`, form({
      budget_total: '250000',
    })), env());
    expect(response.status).toBe(302);
    expect(cms.pages.get(wedding.id)!.lect.budget_total).toBe('250000');
  });
});

describe('rundown', () => {
  it('generates a scope-filtered rundown once', async () => {
    const cms = cmsStub();
    const wedding = cms.insert({
      page_type: 'wedding',
      name: 'W',
      start: '2027-05-15T00:00',
      lect: { scope_registry: 'yes', checklist_language: 'zh' },
    });

    let response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}/rundown/generate`, { method: 'POST' }), env());
    expect(response.status).toBe(302);
    const items = [...cms.pages.values()].filter((page) => page.page_type === 'rundown_item');
    expect(items.length).toBeGreaterThan(0);
    // Registry item seeds; church- and banquet-only items do not.
    expect(items.some((item) => item.name === '證婚儀式及簽署婚書')).toBe(true);
    expect(items.some((item) => item.name === '教堂行禮')).toBe(false);
    expect(items.some((item) => item.name === '新人進場')).toBe(false);

    // A second generate must not duplicate the run sheet.
    const before = items.length;
    response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}/rundown/generate`, { method: 'POST' }), env());
    expect(response.status).toBe(302);
    expect([...cms.pages.values()].filter((page) => page.page_type === 'rundown_item')).toHaveLength(before);
  });

  it('orders the rundown by time', async () => {
    const cms = cmsStub();
    const wedding = cms.insert({ page_type: 'wedding', name: 'W', start: '2027-05-15T00:00', lect: {} });
    cms.insert({ page_type: 'rundown_item', name: 'Banquet', lect: { time: '19:30', _pointers: { wedding: String(wedding.id) } } });
    cms.insert({ page_type: 'rundown_item', name: 'Makeup', lect: { time: '06:00', _pointers: { wedding: String(wedding.id) } } });

    const response = await plugin.fetch(adminRequest(`/__plugin/admin/weddings/${wedding.id}/rundown`), env());
    const data = await response.clone().json() as { items: Array<{ name: string }> };
    expect(data.items.map((item) => item.name)).toEqual(['Makeup', 'Banquet']);
  });
});
