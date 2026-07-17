// ============================================================
// Worker CMS plugin — "wedding-planner".
//
// Phase-1 planner mimicking the WeVow app's core features on top of the CMS:
// wedding profile + scope questionnaire, a seeded countdown checklist grouped
// by month, a preset budget tracker, and a one-click wedding-day rundown.
//
// Everything is stored as CMS pages through the host Plugin API
// ({CMS_URL}/__cms/*) — this Worker owns NO database. Guests / RSVP / EDM /
// check-in stay in the events plugin; this plugin links alongside it.
// ============================================================

import {
  CmsClient,
  CmsApiError,
  CmsNotConfiguredError,
} from './cms';
import { cmsUserId, forbidden, weddingAdminAccessForRequest } from './permissions';
import { adminView } from './templates/views';
import {
  createWeddingFromForm,
  deleteWedding,
  deleteWeddingForm,
  newWeddingForm,
  weddingDashboard,
  weddingsList,
} from './wedding';
import {
  checklistView,
  createTask,
  deleteTask,
  taskForm,
  toggleTask,
  updateTask,
} from './checklist';
import {
  budgetItemForm,
  budgetView,
  createBudgetItem,
  deleteBudgetItem,
  updateBudgetItem,
  updateBudgetTotal,
} from './budget';
import {
  createRundownItem,
  deleteRundownItem,
  generateRundown,
  rundownItemForm,
  rundownView,
  updateRundownItem,
} from './rundown';
import {
  requireTenant,
  serveViewAsset,
  tenantClientEnv,
} from '@lionrockjs/worker-cms-plugin';
// The plugin manifest (content types, nav, permissions) is plain data, so it
// lives as a static JSON file served verbatim at /__plugin/manifest.
import MANIFEST from './manifest.json';

interface PluginEnv {
  PLUGIN_SECRET?: string;
  /** Base URL of the CMS Worker (for the Plugin API write-back API). */
  CMS_URL?: string;
  /** Multi-tenant registry: `tenant:<cms origin>` → TenantConfig JSON. When
   *  unbound, CMS_URL + PLUGIN_SECRET form the single legacy tenant. */
  TENANTS?: KVNamespace;
  /** Plugin-owned Liquid templates and other view assets. */
  VIEWS: Fetcher;
  /** Deploy identifier exposed in the manifest to invalidate cached views. */
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

export default {
  async fetch(request: Request, baseEnv: PluginEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Secret-authenticated host calls resolve their tenant (x-cms-tenant +
    // x-plugin-secret verified against the SAME registry row), then all
    // downstream code runs against a tenant-scoped env.
    let env = baseEnv;
    const secretRequired = path.startsWith('/__plugin/hooks/') || path.startsWith('/__plugin/admin');
    if (secretRequired) {
      const tenant = await requireTenant(request, baseEnv);
      if (tenant instanceof Response) return tenant;
      env = tenantClientEnv(baseEnv, tenant);
    }

    if (path === '/__plugin/manifest') {
      return Response.json({
        ...MANIFEST,
        ...(baseEnv.CF_VERSION_METADATA ? { workerVersion: baseEnv.CF_VERSION_METADATA } : {}),
      });
    }

    // Plugin-owned view templates, served to the CMS's composite view resolver.
    if (path.startsWith('/__plugin/views/')) {
      const assetPath = path.slice('/__plugin/views'.length) || '/';
      return serveViewAsset(env.VIEWS, assetPath);
    }

    if (path.startsWith('/__plugin/hooks/')) {
      // No hooks are declared in the manifest; acknowledge anything delivered.
      return new Response('ok');
    }

    if (path.startsWith('/__plugin/admin')) {
      return handleAdmin(request, env, url);
    }

    return new Response('not found', { status: 404 });
  },
};

function wantsJson(url: URL): boolean {
  const json = url.searchParams.get('json')?.trim().toLowerCase();
  const format = url.searchParams.get('format')?.trim().toLowerCase();
  return format === 'json' || (url.searchParams.has('json') && json !== '0' && json !== 'false');
}

/** Renders an error panel when the CMS link is unconfigured or returns an error. */
function errorPanel(views: Fetcher, message: string, showConfig = false, jsonOnly = false): Promise<Response> {
  return adminView(views, 'Error', 'error', { message, showConfig }, jsonOnly);
}

// ── Admin router ──────────────────────────────────────────────────────────────

async function handleAdmin(request: Request, env: PluginEnv, url: URL): Promise<Response> {
  const rest = url.pathname.replace(/^\/__plugin\/admin\/?/, '');
  const segments = rest.split('/').filter(Boolean);
  const section = segments[0] || 'weddings';
  const jsonOnly = wantsJson(url);

  if (section === 'views') {
    return serveViewAsset(env.VIEWS, `/${segments.slice(1).join('/')}`, { bareLiquidSnippets: true });
  }

  let cms: CmsClient;
  try {
    // Attribute all CMS writes in this request to the signed-in admin, so
    // host-side credit costs land on their balance.
    cms = new CmsClient(env).actAs(cmsUserId(request));
  } catch (error) {
    if (error instanceof CmsNotConfiguredError) return errorPanel(env.VIEWS, error.message, true, jsonOnly);
    throw error;
  }

  const access = weddingAdminAccessForRequest(request);
  if (!access.canView) return forbidden();
  const post = request.method === 'POST';

  // Each handler is `await`ed (not bare-returned) so a CmsApiError it throws is
  // caught below and rendered as an error panel rather than escaping this
  // function as an unhandled 500.
  try {
    if (section !== 'weddings') return new Response('not found', { status: 404 });

    // /weddings/new
    if (segments[1] === 'new') {
      if (!access.canEdit) return forbidden();
      if (post) return await createWeddingFromForm(request, cms);
      return await newWeddingForm(cms, env.VIEWS, jsonOnly);
    }

    const weddingId = segments[1] ? Number(segments[1]) : null;
    if (weddingId !== null && !Number.isInteger(weddingId)) return new Response('not found', { status: 404 });
    const sub = segments[2] ?? '';

    if (!weddingId) return await weddingsList(cms, env.VIEWS, url, jsonOnly, access);

    if (sub === 'delete') {
      if (!access.canDelete) return forbidden();
      if (post) return await deleteWedding(cms, weddingId);
      return await deleteWeddingForm(cms, env.VIEWS, weddingId, jsonOnly);
    }

    if (sub === 'checklist') {
      const third = segments[3] ?? '';
      if (third === 'new') {
        if (!access.canEdit) return forbidden();
        if (post) return await createTask(request, cms, weddingId, url);
        return await taskForm(cms, env.VIEWS, weddingId, null, url, jsonOnly);
      }
      const taskId = third ? Number(third) : null;
      if (taskId !== null && !Number.isInteger(taskId)) return new Response('not found', { status: 404 });
      if (taskId) {
        const action = segments[4] ?? '';
        if (action === 'toggle' && post) {
          if (!access.canEdit) return forbidden();
          return await toggleTask(cms, weddingId, taskId, url);
        }
        if (action === 'delete' && post) {
          if (!access.canEdit) return forbidden();
          return await deleteTask(cms, weddingId, taskId, url);
        }
        if (action) return new Response('not found', { status: 404 });
        if (post) {
          if (!access.canEdit) return forbidden();
          return await updateTask(request, cms, weddingId, taskId, url);
        }
        return await taskForm(cms, env.VIEWS, weddingId, taskId, url, jsonOnly);
      }
      return await checklistView(cms, env.VIEWS, weddingId, url, jsonOnly, access);
    }

    if (sub === 'budget') {
      const third = segments[3] ?? '';
      if (third === 'total' && post) {
        if (!access.canEdit) return forbidden();
        return await updateBudgetTotal(request, cms, weddingId);
      }
      if (third === 'new') {
        if (!access.canEdit) return forbidden();
        if (post) return await createBudgetItem(request, cms, weddingId);
        return await budgetItemForm(cms, env.VIEWS, weddingId, null, jsonOnly);
      }
      const itemId = third ? Number(third) : null;
      if (itemId !== null && !Number.isInteger(itemId)) return new Response('not found', { status: 404 });
      if (itemId) {
        const action = segments[4] ?? '';
        if (action === 'delete' && post) {
          if (!access.canEdit) return forbidden();
          return await deleteBudgetItem(cms, weddingId, itemId);
        }
        if (action) return new Response('not found', { status: 404 });
        if (post) {
          if (!access.canEdit) return forbidden();
          return await updateBudgetItem(request, cms, weddingId, itemId);
        }
        return await budgetItemForm(cms, env.VIEWS, weddingId, itemId, jsonOnly);
      }
      return await budgetView(cms, env.VIEWS, weddingId, url, jsonOnly, access);
    }

    if (sub === 'rundown') {
      const third = segments[3] ?? '';
      if (third === 'generate' && post) {
        if (!access.canEdit) return forbidden();
        return await generateRundown(cms, weddingId);
      }
      if (third === 'new') {
        if (!access.canEdit) return forbidden();
        if (post) return await createRundownItem(request, cms, weddingId);
        return await rundownItemForm(cms, env.VIEWS, weddingId, null, jsonOnly);
      }
      const itemId = third ? Number(third) : null;
      if (itemId !== null && !Number.isInteger(itemId)) return new Response('not found', { status: 404 });
      if (itemId) {
        const action = segments[4] ?? '';
        if (action === 'delete' && post) {
          if (!access.canEdit) return forbidden();
          return await deleteRundownItem(cms, weddingId, itemId);
        }
        if (action) return new Response('not found', { status: 404 });
        if (post) {
          if (!access.canEdit) return forbidden();
          return await updateRundownItem(request, cms, weddingId, itemId);
        }
        return await rundownItemForm(cms, env.VIEWS, weddingId, itemId, jsonOnly);
      }
      return await rundownView(cms, env.VIEWS, weddingId, url, jsonOnly, access);
    }

    if (sub) return new Response('not found', { status: 404 });
    return await weddingDashboard(cms, env.VIEWS, weddingId, url, jsonOnly, access);
  } catch (error) {
    if (error instanceof CmsApiError) {
      // The host rejects creates that would cross an admin-configured quota
      // (Plugins → Limits) with 409 limit_exceeded. Nothing was written.
      if (error.code === 'limit_exceeded') {
        return errorPanel(
          env.VIEWS,
          'A configured limit has been reached, so nothing was created. Remove existing items, or ask an administrator to raise the limit under Plugins → Limits.',
          false,
          jsonOnly,
        );
      }
      if (error.code === 'insufficient_credits') {
        return errorPanel(
          env.VIEWS,
          'You do not have enough credits for this action, so nothing was changed. Check your balance on your profile page, or ask an administrator to top it up.',
          false,
          jsonOnly,
        );
      }
      const target = error.method && error.path ? ` ${error.method} ${error.path}` : '';
      return errorPanel(env.VIEWS, `CMS responded${target} ${error.status} (${error.code}).`, false, jsonOnly);
    }
    throw error;
  }
}
