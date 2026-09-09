import type { WorldSession } from './core/contract.js';

/** A short-lived, world-scoped account handoff. Never persist or log its context. */
export interface AccountContext {
  context: string;
  expiresAt: number;
  accountUrl?: string;
  frameUrl: string;
  parentOrigin: string;
}

/** Compatibility name for integrations built before hosted account navigation. */
export type EmbeddedAccountContext = AccountContext;
export interface AccountPageOptions {
  mode?: 'signup' | 'signin';
}
export type AccountDialogOptions = AccountPageOptions;
export interface AccountPageClient {
  createAccountContext(): Promise<AccountContext>;
}
export type AccountDialogClient = AccountPageClient;

let activeNavigation: Promise<void> | undefined;

/** Visit WorldsBay as the top-level page so its first-party login and password
 * manager work normally. Central returns to the originating game after success
 * or cancellation. Rejects if the handoff could not start; resolves only when
 * browser Back restores the game from its page cache, so controls can unlock.
 */
export function openAccountPage(client: AccountPageClient, options: AccountPageOptions = {}): Promise<void> {
  if (activeNavigation) return activeNavigation;
  const operation = (async () => {
    const next = await client.createAccountContext();
    const target = new URL(next.accountUrl ?? '/account/start', next.frameUrl);
    if (
      next.parentOrigin !== location.origin ||
      !['https:', 'http:'].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      target.pathname !== '/account/start' ||
      target.origin !== new URL(next.frameUrl).origin ||
      !/^[A-Za-z0-9_-]{43}$/.test(next.context) ||
      !Number.isFinite(next.expiresAt) ||
      next.expiresAt <= Date.now()
    )
      throw new Error('The account connection does not match this game. Please try again.');
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = target.href;
    form.hidden = true;
    for (const [name, value] of Object.entries({ context: next.context, mode: options.mode ?? 'signup' })) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    let restore!: () => void;
    const restored = new Promise<void>((resolve) => {
      restore = resolve;
    });
    const onRestore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      window.removeEventListener('pageshow', onRestore);
      form.remove();
      restore();
    };
    window.addEventListener('pageshow', onRestore);
    try {
      // POST keeps the bearer handoff out of history, referrers, and access URLs.
      form.submit();
    } catch (error) {
      window.removeEventListener('pageshow', onRestore);
      form.remove();
      throw error;
    }
    // Keep the calling game's controls locked until its document unloads.
    return restored;
  })();
  activeNavigation = operation;
  void operation
    .finally(() => {
      if (activeNavigation === operation) activeNavigation = undefined;
    })
    .catch(() => {});
  return operation;
}

/** @deprecated Use openAccountPage. This compatibility entry now navigates too. */
export function openAccountDialog(
  client: AccountDialogClient,
  options: AccountDialogOptions = {},
): Promise<WorldSession | null> {
  return openAccountPage(client, options).then(() => null);
}
