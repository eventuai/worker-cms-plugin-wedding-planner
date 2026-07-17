// ============================================================
// Wedding Planner CMS bridge.
//
// Shared Plugin API client/types and neutral lect readers live in
// @lionrockjs/worker-cms-plugin. Everything the planner stores — weddings,
// checklist tasks, budget items, rundown items — is a CMS page (the plugin has
// no database of its own). This file adds only the planner-specific helpers.
// ============================================================

import {
  CmsClient as BaseCmsClient,
  attr,
  compareByWeightThenName,
  items,
  localized,
  pointer,
  type CmsClientEnv,
  type CmsListPointer,
  type CmsPage,
  type CmsPageInput,
  CmsApiError,
  CmsNotConfiguredError,
} from '@lionrockjs/worker-cms-plugin';

/** Manifest id — must equal MANIFEST.id and the CMS-registered plugin id. */
export const PLUGIN_ID = 'wedding-planner';

export const ADMIN_BASE = `/admin/plugins/${PLUGIN_ID}`;

/** Native CMS admin endpoint used by drag-sort tables to persist page weights in one request. */
export const CMS_BATCH_WEIGHT_ACTION = '/admin/pages/batch-weight';

export {
  CmsApiError,
  CmsNotConfiguredError,
  attr,
  compareByWeightThenName,
  items,
  localized,
  pointer,
  type CmsClientEnv,
  type CmsPage,
  type CmsPageInput,
};

/**
 * Selects a related collection of pages for the bulk delete operation. Planner
 * children reference their wedding by the `wedding` lect pointer.
 */
export type CollectionSelector =
  | { pointerKey: string; pointerValue: string }
  | { parentPageId: number };

function selectorFields(selector: CollectionSelector): Record<string, unknown> {
  return 'pointerKey' in selector
    ? { pointer_key: selector.pointerKey, pointer_value: selector.pointerValue }
    : { parent_page_id: selector.parentPageId };
}

export class CmsClient extends BaseCmsClient {
  /** The base `call`/`json` are private, so the extensions keep their own copy of the link config. */
  private readonly link: { base: string; secret: string };
  private actingUserId: string | null = null;

  constructor(env: CmsClientEnv) {
    super({
      cmsUrl: env.CMS_URL,
      pluginSecret: env.PLUGIN_SECRET,
      pluginId: PLUGIN_ID,
      // The wrapper adds x-acting-user-id (when set) to every base-client
      // call, so the host can charge credit costs to the signed-in admin.
      fetcher: (input, init) => globalThis.fetch(input, this.withActingUser(init)),
    });
    this.link = { base: (env.CMS_URL ?? '').replace(/\/+$/, ''), secret: env.PLUGIN_SECRET ?? '' };
  }

  /**
   * Attributes subsequent CMS calls to the signed-in admin (from the
   * `x-cms-user` summary the host forwards), so host-side credit costs are
   * charged to them.
   */
  actAs(userId: string | number | null | undefined): this {
    this.actingUserId = userId === null || userId === undefined || userId === '' ? null : String(userId);
    return this;
  }

  get hasActingUser(): boolean {
    return this.actingUserId !== null;
  }

  /**
   * Every page matching the query. The host clamps `/__cms/pages` to 500 rows
   * per call no matter what `limit` asks, so a plain `list()` silently
   * truncates collections past 500 — this pages by offset until the set is
   * exhausted. Planner collections are small (≤ a few hundred tasks), so no
   * backoff machinery is needed here.
   */
  async listAll(
    pageType: string,
    opts: { parentId?: number; pointer?: CmsListPointer; q?: string } = {},
  ): Promise<CmsPage[]> {
    const pages: CmsPage[] = [];
    const pageSize = 500;
    for (;;) {
      const { pages: chunk, total } = await this.list(pageType, { ...opts, limit: pageSize, offset: pages.length });
      pages.push(...chunk);
      if (!chunk.length || chunk.length < pageSize || pages.length >= total) return pages;
    }
  }

  /**
   * Server-side bulk soft-delete of a related collection (CMS `DELETE
   * /pages/children`). Trashes the work in the CMS Worker — no child ids stream
   * back to the plugin — and repeats while the host reports more remain.
   * Returns the total trashed.
   */
  async deleteChildren(selector: CollectionSelector, pageType: string): Promise<number> {
    let total = 0;
    for (;;) {
      const response = await globalThis.fetch(`${this.link.base}/__cms/pages/children`, {
        method: 'DELETE',
        headers: this.linkHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ ...selectorFields(selector), page_type: pageType }),
      });
      if (!response.ok) {
        const code = await response.text().then((text) => text.trim().slice(0, 160) || 'error').catch(() => 'error');
        throw new CmsApiError(response.status, code, 'DELETE', '/pages/children');
      }
      const result = await response.json() as { trashed: number; done: boolean };
      total += result.trashed;
      // Guard against a non-progressing response (nothing trashed yet not done).
      if (result.done || result.trashed === 0) break;
    }
    return total;
  }

  private withActingUser(init?: RequestInit): RequestInit {
    if (!this.actingUserId) return init ?? {};
    const headers = new Headers(init?.headers);
    headers.set('x-acting-user-id', this.actingUserId);
    // Plain object (not a Headers instance) so callers and tests that inspect
    // init.headers by key keep working.
    return { ...init, headers: Object.fromEntries(headers.entries()) };
  }

  /** Auth + attribution headers for this class's own raw /__cms fetches. */
  private linkHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'x-plugin-secret': this.link.secret,
      'x-plugin-id': PLUGIN_ID,
      ...(this.actingUserId ? { 'x-acting-user-id': this.actingUserId } : {}),
      ...extra,
    };
  }

  /**
   * Reports metered usage for a manifest-declared cost (CMS `POST
   * /__cms/credits/charge`). The host prices it from its own configuration and
   * deducts from the acting user.
   */
  async chargeUsage(
    key: string,
    quantity: number,
    opts: { entityType?: string; entityId?: string | number; note?: string } = {},
  ): Promise<void> {
    const response = await globalThis.fetch(`${this.link.base}/__cms/credits/charge`, {
      method: 'POST',
      headers: this.linkHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        key,
        quantity,
        entity_type: opts.entityType,
        entity_id: opts.entityId,
        note: opts.note,
      }),
    });
    if (!response.ok) {
      const code = await response.text()
        .then((text) => {
          try { return (JSON.parse(text) as { error?: string }).error || 'error'; } catch { return text.trim().slice(0, 160) || 'error'; }
        })
        .catch(() => 'error');
      throw new CmsApiError(response.status, code, 'POST', '/credits/charge');
    }
  }
}

/** Charges a metered credit action, tolerating an unpriced/unavailable credits API. */
export async function chargeCreditAction(
  cms: CmsClient,
  key: string,
  quantity = 1,
  opts: { entityType?: string; entityId?: string | number; note?: string } = {},
): Promise<void> {
  if (!cms.hasActingUser || quantity <= 0) return;
  try {
    await cms.chargeUsage(key, quantity, opts);
  } catch (error) {
    if (error instanceof CmsApiError && error.status === 402) throw error;
    console.error(`[wedding-planner] ${key} charge failed (non-blocking)`, error);
  }
}

/**
 * Lists the pages of a type that belong to a wedding. Checklist tasks, budget
 * items and rundown items group under their wedding by `lect._pointers.wedding`
 * (pointer-filtered host-side), not by parent page.
 */
export async function listByWedding(cms: CmsClient, pageType: string, weddingId: number): Promise<CmsPage[]> {
  return cms.listAll(pageType, { pointer: { key: 'wedding', value: weddingId } });
}

/** `attr` normalized to a trimmed lowercase yes/no switch. */
export function isYes(lect: Record<string, unknown>, key: string): boolean {
  return attr(lect, key).trim().toLowerCase() === 'yes';
}

/** Parses a lect money field to a non-negative number (blank/invalid → 0). */
export function money(lect: Record<string, unknown>, key: string): number {
  const parsed = Number.parseFloat(attr(lect, key).replace(/[,$\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Formats a number for display with thousands separators, dropping ".0". */
export function formatMoney(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** The wedding date (YYYY-MM-DD) from the wedding page's native start column. */
export function weddingDate(wedding: CmsPage): string {
  return (wedding.start ?? '').slice(0, 10);
}

/** Whole days from today (UTC) until the wedding date; negative when past. */
export function daysUntil(dateText: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateText)) return null;
  const target = Date.parse(`${dateText.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(target)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/** `YYYY-MM` shifted by a number of months (offset 3 → 3 months earlier). */
export function monthMinus(dateText: string, offsetMonths: number): string {
  const year = Number.parseInt(dateText.slice(0, 4), 10);
  const month = Number.parseInt(dateText.slice(5, 7), 10);
  const index = year * 12 + (month - 1) - offsetMonths;
  const outYear = Math.floor(index / 12);
  const outMonth = index - outYear * 12 + 1;
  return `${String(outYear).padStart(4, '0')}-${String(outMonth).padStart(2, '0')}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-05" → "May 2027" (invalid input echoes back unchanged). */
export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const index = Number.parseInt(match[2], 10) - 1;
  return index >= 0 && index < 12 ? `${MONTH_NAMES[index]} ${match[1]}` : month;
}
