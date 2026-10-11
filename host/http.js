/**
 * The HTTP surface between the browser half and the Host half.
 *
 * The Harness serves plugin bundles over its own web carrier, so the page and
 * this route already share an origin and a session. Only JSON crosses the
 * boundary; every action is a POST carrying `{ action, payload }`, so adding
 * one never means touching routing.
 *
 * Two guards matter, because a route registered here runs code that can touch
 * the filesystem and run `git`: a custom header defeats cross-site form posts
 * (a browser must preflight a request that carries it), and a cross-origin
 * `Origin` is refused outright.
 * @module @local/dsh-sync/host/api
 */

/** Route prefix owned by this plugin. */
export const API_PREFIX = '/dsh-sync/api';

/** Header the browser half must send; browsers cannot set it cross-origin. */
const GUARD_HEADER = 'x-dsh-sync';

/** Largest request body accepted, in bytes. */
const BODY_LIMIT = 512 * 1024;

/**
 * Read and parse a request body.
 * @param req - the incoming request.
 * @returns the parsed JSON value, or `undefined`.
 */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) return undefined;
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Send one JSON answer.
 * @param res - the response to own.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * Reject requests that a hostile page could have forged.
 * @param req - the incoming request.
 * @returns a message when the request must be refused.
 */
function guard(req) {
  if (req.headers[GUARD_HEADER] === undefined) return 'missing request header';
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null') {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return 'unreadable origin';
    }
    if (host !== req.headers.host) return 'cross-origin request';
  }
  return undefined;
}

/**
 * Build the request handler.
 * @param options - the engine, logger and credential helpers.
 * @returns a web carrier route handler.
 */
export function createApiHandler(options) {
  const { engine, logger, setToken, describeToken, triggerSync, onSettingsChanged } = options;

  /** One action table; every entry answers `{ ok, data }` or throws. */
  const actions = {
    'state': () => engine.status({ force: true }),
    'sync': async (payload) => {
      const direction = payload?.direction === 'push' || payload?.direction === 'pull' ? payload.direction : 'both';
      const result = await triggerSync({ direction, trigger: 'manual' });
      return { result, status: await engine.status({ force: true }) };
    },
    'prepareRemote': (payload) => engine.prepareRemote(payload ?? {}),
    'setup': async (payload) => {
      /*
       * Only a token the user actually typed is written. An empty field must
       * leave an already stored token alone: that field is empty precisely when
       * the token is already saved, so treating an empty value as "remove"
       * would delete a working credential on the most ordinary run of the
       * wizard.
       */
      const typed = typeof payload?.token === 'string' ? payload.token.trim() : '';
      if (typed !== '') await setToken(typed);
      const result = await engine.configure(payload ?? {});
      if (result.ok !== true) return result;
      await onSettingsChanged?.();
      return { ...result, status: await engine.status({ force: true }) };
    },
    'join': async (payload) => {
      const parsed = engine.parsePairCode(payload?.code);
      if (parsed.ok !== true) return parsed;
      /*
       * The token may arrive in the pasted code (the wizard's "include the
       * token in the code" option) or be typed into the form. The typed one
       * wins; the embedded one is the whole point of that option. When neither
       * is present the stored credential is left alone, so re-joining a store
       * never wipes a token that already works.
       */
      const typed = typeof payload?.token === 'string' ? payload.token.trim() : '';
      const embedded = typeof parsed.payload.token === 'string' ? parsed.payload.token.trim() : '';
      const token = typed !== '' ? typed : embedded;
      if (token !== '') await setToken(token);
      const result = await engine.configure({
        kind: parsed.payload.kind,
        remote: parsed.payload.remote,
        branch: parsed.payload.branch,
        folder: parsed.payload.dir,
        items: parsed.payload.items,
        deviceName: payload?.deviceName,
        copy: payload?.copy,
      });
      if (result.ok !== true) return result;
      await onSettingsChanged?.();
      return { ...result, status: await engine.status({ force: true }) };
    },
    'pair': (payload) => engine.pairInfo({ withToken: payload?.withToken === true }),
    'token': () => describeToken(),
    'items': async (payload) => {
      const result = await engine.setItems(payload?.items ?? {});
      return { ...result, status: await engine.status({ force: true }) };
    },
    'autoSync': (payload) => engine.setAutoSync(payload ?? {}),
    'copy': (payload) => engine.setCopy(payload?.copy),
    'deviceName': (payload) => engine.setDeviceName(payload?.name),
    'conflict': async (payload) => {
      const result = await engine.resolveConflict(payload ?? {});
      return { ...result, status: await engine.status({ force: true }) };
    },
    'pathMapping': async (payload) => {
      const result = await engine.setPathMapping(payload ?? {});
      return { ...result, status: await engine.status({ force: true }) };
    },
    'disconnect': async () => {
      const result = await engine.disconnect();
      return { ...result, status: await engine.status({ force: true }) };
    },
    'adopt': async () => {
      const result = await engine.adoptRemote();
      return { ...result, status: await engine.status({ force: true }) };
    },
    'rescan': async () => {
      engine.rescan();
      return await engine.status({ force: true });
    },
    'test': async () => {
      const status = await engine.status({});
      return { reachable: status.store !== undefined, status };
    },
  };

  return async function handle(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://dsh.invalid');
      const action = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '').replace(/\/+$/, '');
      if (req.method === 'GET' && action === 'state') {
        send(res, 200, { ok: true, data: await engine.status({ force: true }) });
        return;
      }
      if (req.method !== 'POST') {
        send(res, 405, { ok: false, error: { message: 'Только POST' } });
        return;
      }
      const refusal = guard(req);
      if (refusal !== undefined) {
        send(res, 403, { ok: false, error: { message: 'Запрос отклонён' } });
        return;
      }
      const body = await readBody(req);
      if (body === undefined) {
        send(res, 400, { ok: false, error: { message: 'Некорректный запрос' } });
        return;
      }
      const handler = actions[action];
      if (handler === undefined) {
        send(res, 404, { ok: false, error: { message: `Неизвестное действие: ${action}` } });
        return;
      }
      const started = Date.now();
      const data = await handler(body?.payload ?? body);
      logger?.debug?.(`dsh-sync: ${action} за ${String(Date.now() - started)} мс`);
      send(res, 200, { ok: true, data });
    } catch (error) {
      const message = String(error?.message ?? error);
      logger?.warn?.(`dsh-sync: ${req.url ?? ''} — ${message}`);
      send(res, 200, { ok: false, error: { message } });
    }
  };
}

/**
 * Whether a request is addressed to this plugin's route.
 * @param req - the incoming request.
 * @returns true when the path belongs here.
 */
export function matchesRoute(req) {
  const path = (req.url ?? '').split('?')[0] ?? '';
  return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
}
