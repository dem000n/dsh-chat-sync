/**
 * Host half of the chat-sync plugin.
 *
 * It owns three things: the synchronization engine, one HTTP route the page
 * talks to, and the background timer that keeps chats flowing while nobody is
 * looking. The browser half is served automatically from this package's
 * `dsh.client` declaration, so there is no second loader row.
 *
 * This entry deliberately has no static imports of its own modules. A loader
 * row is imported inside the running Harness, and a module whose dependency
 * graph fails to link is reported as an opaque "failed to import" with the
 * module body never running — nothing to log, nothing to see. Loading the rest
 * of the plugin dynamically turns such a failure into a logged one and keeps
 * the route registered while it happens.
 * @module @local/dsh-chat-sync
 */

/** Cordis plugin name. */
export const name = 'dsh-chat-sync';

/** Required service: the browser HTTP carrier this plugin registers a route on. */
export const inject = ['webServer'];

/** Route prefix owned by this plugin; the API module declares the same path. */
const API_PREFIX = '/dsh-sync/api';

/** Credential reference holding the git access token, if the user supplied one. */
const TOKEN_REF = 'DSH_SYNC_GIT_TOKEN';

/** Shortest sensible automatic sync interval, in minutes. */
const MIN_INTERVAL_MINUTES = 3;

/** How long after startup the first quiet catch-up runs. */
const STARTUP_DELAY_MS = 45000;

/**
 * Load the plugin's own modules.
 * @returns the loaded modules, or the failure text.
 */
async function loadHostModules() {
  try {
    const [api, engine] = await Promise.all([
      import('./host/http.js'),
      import('./host/sync.js'),
    ]);
    return { api, createEngine: engine.createEngine, error: undefined };
  } catch (error) {
    return { api: undefined, createEngine: undefined, error: `dsh-chat-sync: could not load its Host modules.\n${String(error?.stack ?? error)}` };
  }
}

/** The module load, started once when the row is imported. */
const loading = loadHostModules();

/**
 * Everything the engine needs from the running Harness.
 *
 * These are looked up through the plugin context instead of imported, so the
 * plugin keeps working when a deployment composes only some of them, and so no
 * Harness-internal module is ever loaded by name.
 * @param ctx - the Host plugin context.
 * @returns the adapter handed to the engine.
 */
function createHostAdapter(ctx) {
  return {
    /**
     * Whether this process currently holds a chat open. A chat that is open
     * keeps its append position in memory, so its file must not be replaced.
     * @param sessionId - the chat to test.
     * @returns true when the chat is live here.
     */
    isSessionLive(sessionId) {
      try {
        if (ctx.get('sessions')?.get?.(sessionId) !== undefined) return true;
        if (ctx.get('agents')?.get?.(sessionId) !== undefined) return true;
      } catch {
        /* a missing service simply means "cannot tell" */
      }
      return false;
    },
    /**
     * Folder paths the running workspace registry knows about.
     * @returns absolute paths, or an empty list when the service is absent.
     */
    async listWorkspacePaths() {
      const registry = ctx.get('workspaceRegistry');
      if (registry === undefined) return [];
      try {
        const list = registry.list();
        return (Array.isArray(list) ? list : [])
          .map((workspace) => (typeof workspace?.path === 'string' ? workspace.path : undefined))
          .filter((value) => value !== undefined);
      } catch {
        return [];
      }
    },
    /**
     * Make sure one chat is listed under one folder.
     *
     * This is the only supported way to change grouping while the Harness runs:
     * the registry lives in memory and rewrites its whole document on every
     * change, and its loader rejects a document with repeated folders or a chat
     * counted twice.
     * @param folder - the workspace folder.
     * @param sessionId - the chat to attach.
     * @returns whether the chat is now part of that workspace.
     */
    async ensureWorkspaceSession(folder, sessionId) {
      const registry = ctx.get('workspaceRegistry');
      if (registry === undefined) return false;
      let workspace = await registry.resolveByPath(folder);
      if (workspace === undefined) {
        const { basename } = await import('node:path');
        workspace = await registry.create(folder, basename(folder) || 'DSH Sync');
      }
      const id = workspace?.id;
      if (id === undefined) return false;
      const entity = registry.get(id);
      if (typeof entity?.attachSession === 'function') await entity.attachSession(sessionId);
      return true;
    },
  };
}

/**
 * Mount the synchronization engine and its HTTP surface.
 * @param ctx - the Host plugin context.
 * @param config - the loader row's configuration.
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger;

  /** Filled in once the modules and the engine are ready. */
  let handler;
  /** Serialize manual syncs so the page can never start two at once. */
  let running;
  /** The background timer, re-armed whenever the interval setting changes. */
  let timer;
  /** The engine, once the modules have loaded. */
  let engineRef;
  /** Timers that must not outlive the plugin. */
  const startupTimers = [];

  /**
   * Store the git token where the Harness keeps secrets, never in the store.
   * @param credentials - the credential service, when the deployment has one.
   * @param token - the token, or an empty string to forget it.
   */
  async function setToken(credentials, token) {
    const value = String(token ?? '').trim();
    if (credentials === undefined) {
      if (value !== '') throw new Error('Хранилище секретов недоступно, токен не сохранён. Перезапустите Harness и повторите.');
      return;
    }
    if (value === '') await credentials.unset(TOKEN_REF);
    else await credentials.set(TOKEN_REF, value);
  }

  /**
   * Describe the stored token without revealing it.
   * @param credentials - the credential service, when present.
   * @returns the credential description.
   */
  async function describeToken(credentials) {
    if (credentials === undefined) return { configured: false, writable: false, source: undefined };
    try {
      const info = await credentials.describe(TOKEN_REF);
      return { configured: info.configured === true, writable: info.writable === true, source: info.source };
    } catch {
      return { configured: false, writable: false, source: undefined };
    }
  }

  /** Reference kept by the injected scope below. */
  let injectedCredentials;

  /**
   * The credential service, resolved when it is needed rather than once.
   *
   * This plugin activates together with the boot tree, and a service another
   * bundle registers is not necessarily there yet at that moment. Capturing it
   * once left the stored git token unreadable — and unwritable — for the whole
   * process. The injected scope covers a service that arrives later, and the
   * plain lookup covers every call after that.
   * @returns the service, or `undefined` when this deployment has none.
   */
  function credentialsNow() {
    return ctx.get('credentials') ?? injectedCredentials;
  }

  try {
    ctx.inject(['credentials'], (scope) => {
      injectedCredentials = scope.credentials;
    });
  } catch {
    /* the plain lookup still finds the service once it exists */
  }

  /** Re-arm the background timer whenever the interval setting changes. */
  function armTimer(engine) {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    const state = engine.getState();
    if (state?.autoSync?.enabled !== true) return;
    const minutes = Math.max(MIN_INTERVAL_MINUTES, Number(state.autoSync.minutes) || 15);
    timer = setInterval(() => {
      void triggerSync({ direction: 'both', trigger: 'auto' });
    }, minutes * 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
  }

  /**
   * Run one synchronization, refusing to start a second one in parallel.
   * @param options - direction and trigger.
   * @returns the sync outcome.
   */
  async function triggerSync(options) {
    if (running !== undefined) return running;
    running = engineRef.runSync(options).finally(() => {
      running = undefined;
    });
    return running;
  }

  /** The engine, once the modules have loaded. */
  const ready = loading.then(async (loaded) => {
    if (loaded.error !== undefined) {
      logger?.error?.(loaded.error);
      return;
    }
    const engine = loaded.createEngine({
      config,
      logger,
      host: createHostAdapter(ctx),
      resolveToken: async () => {
        const credentials = credentialsNow();
        if (credentials === undefined) return '';
        try {
          const resolved = await credentials.resolve(TOKEN_REF);
          return typeof resolved?.value === 'string' ? resolved.value : '';
        } catch {
          return '';
        }
      },
    });
    engineRef = engine;
    handler = loaded.api.createApiHandler({
      engine,
      logger,
      setToken: (token) => setToken(credentialsNow(), token),
      describeToken: () => describeToken(credentialsNow()),
      triggerSync,
      onSettingsChanged: () => armTimer(engine),
    });
    await engine.init();
    armTimer(engine);
    // One quiet catch-up shortly after startup, so a computer that was off for
    // a while has its chats before the user goes looking for them.
    const startup = setTimeout(() => {
      if (engine.getState()?.store !== undefined) void triggerSync({ direction: 'both', trigger: 'startup' });
    }, STARTUP_DELAY_MS);
    if (typeof startup.unref === 'function') startup.unref();
    startupTimers.push(startup);
    logger?.info?.(`dsh-sync: готово, интерфейс — Настройки → Синхронизация чатов (${API_PREFIX})`);
  });

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        await ready.catch(() => undefined);
        if (handler === undefined) {
          res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: { message: 'Плагин синхронизации не загрузился.' } }));
          return;
        }
        await handler(req, res);
      },
    }),
    'dsh-sync: /dsh-sync/api route',
  );

  ctx.effect(() => () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    for (const pending of startupTimers) clearTimeout(pending);
    startupTimers.length = 0;
  }, 'dsh-sync: timers');
}
