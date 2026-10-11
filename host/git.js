/**
 * Thin wrapper over the system `git` executable plus the two hosting APIs the
 * setup wizard uses to create a private repository. The plugin deliberately
 * drives the user's own git instead of shipping one: that keeps repository
 * credentials, proxies and SSH configuration exactly as the user configured
 * them, and keeps the bundle dependency-free.
 * @module @local/dsh-sync/host/git
 */
import { spawn } from 'node:child_process';

/** Environment that keeps git from ever blocking on an interactive prompt. */
const NON_INTERACTIVE = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',
  GCM_INTERACTIVE: 'never',
  GIT_CONFIG_NOSYSTEM: '0',
};

/**
 * Run one process to completion, capturing its output.
 * @param command - executable name or path.
 * @param args - argument vector.
 * @param options - working directory, extra environment and an abort signal.
 * @returns exit code, stdout and stderr as text.
 */
export function runProcess(command, args, options = {}) {
  const { cwd, env, signal, timeoutMs = 10 * 60 * 1000 } = options;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...NON_INTERACTIVE, ...env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${command} timed out after ${String(timeoutMs)} ms`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    if (signal !== undefined) {
      signal.addEventListener('abort', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(new Error('cancelled'));
      }, { once: true });
    }
  });
}

/**
 * Whether a git executable is reachable and which version it is.
 * @returns availability and the reported version line.
 */
export async function gitVersion() {
  try {
    const result = await runProcess('git', ['--version'], { timeoutMs: 20000 });
    if (result.code !== 0) return { available: false, version: undefined };
    return { available: true, version: result.stdout.trim() };
  } catch {
    return { available: false, version: undefined };
  }
}

/**
 * Turn whatever the user typed into a git remote URL. Shorthands are
 * accepted so nobody has to know the spelling rules.
 * @param raw - user input.
 * @returns the normalized remote URL, or `undefined` when it cannot be one.
 */
export function normalizeRemote(raw) {
  const value = String(raw ?? '').trim().replace(/^git\+/, '');
  if (value === '') return undefined;
  if (/^[a-z]+:\/\//i.test(value) || /^git@[^:]+:/i.test(value)) return value;
  const hosted = /^(github|gitlab|bitbucket):(.+)$/i.exec(value);
  if (hosted !== null) {
    const host = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }[hosted[1].toLowerCase()];
    return `https://${host}/${hosted[2].replace(/^\/+/, '')}`;
  }
  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(value);
  if (shorthand !== null) return `https://github.com/${value}`;
  if (/^[\w.-]+\.[a-z]{2,}\/\S+$/i.test(value)) return `https://${value}`;
  return undefined;
}

/**
 * Human-readable `host/owner/repo` label for a remote URL.
 * @param url - normalized remote URL.
 * @returns the label, or the URL itself when it does not parse.
 */
export function remoteLabel(url) {
  const match = /^(?:https?:\/\/|git@)([^/:]+)[/:](.+?)(?:\.git)?$/i.exec(String(url ?? '').trim());
  if (match === null) return String(url ?? '');
  return `${match[1]}/${match[2]}`;
}

/**
 * The `-c` arguments that authenticate one HTTPS request without writing the
 * token into `.git/config`, the reflog or the remote URL. SSH remotes carry
 * their own authentication, so they get nothing.
 * @param url - remote URL.
 * @param token - personal access token, or an empty string.
 * @returns extra git arguments.
 */
export function authArguments(url, token) {
  const secret = String(token ?? '').trim();
  if (secret === '') return [];
  if (/^git@/i.test(url) || /^ssh:\/\//i.test(url)) return [];
  let host = '';
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return [];
  }
  const user = host.includes('gitlab') ? 'oauth2' : host.includes('github') ? 'x-access-token' : 'git';
  const basic = Buffer.from(`${user}:${secret}`, 'utf8').toString('base64');
  return ['-c', `http.extraheader=AUTHORIZATION: basic ${basic}`, '-c', 'credential.helper='];
}

/**
 * Run one git command inside a repository.
 * @param cwd - repository directory.
 * @param args - git arguments.
 * @param options - token, extra args, signal and timeout.
 * @returns the process result.
 */
export async function git(cwd, args, options = {}) {
  const { token = '', remote = '', signal, timeoutMs } = options;
  const prefix = remote === '' ? [] : authArguments(remote, token);
  const result = await runProcess('git', [...prefix, ...args], { cwd, signal, timeoutMs });
  return result;
}

/**
 * Run git and turn a non-zero exit into an error carrying git's own message.
 * @param cwd - repository directory.
 * @param args - git arguments.
 * @param options - token, remote, signal and timeout.
 * @returns stdout on success.
 */
export async function gitOrThrow(cwd, args, options = {}) {
  const result = await git(cwd, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(-4).join(' ');
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout;
}

/**
 * Check that a remote is reachable, which also proves the token is accepted.
 * @param url - remote URL.
 * @param token - personal access token, or an empty string.
 * @returns reachability plus a translated diagnostic.
 */
export async function probeRemote(url, token) {
  const result = await runProcess(
    'git',
    [...authArguments(url, token), 'ls-remote', '--heads', url],
    { timeoutMs: 60000 },
  );
  if (result.code === 0) {
    const heads = result.stdout.split('\n').filter((line) => line.trim() !== '');
    return { reachable: true, empty: heads.length === 0, message: undefined };
  }
  const text = `${result.stderr}${result.stdout}`;
  let message = 'Не удалось подключиться к репозиторию.';
  if (/could not read Username|Authentication failed|403|401|invalid username or password/i.test(text)) {
    message = 'Репозиторий недоступен: проверьте токен доступа (или он не имеет прав на этот репозиторий).';
  } else if (/not found|repository .* not found|does not appear to be a git repository/i.test(text)) {
    message = 'Репозиторий не найден: проверьте адрес и что он создан.';
  } else if (/Could not resolve host|unable to access|network/i.test(text)) {
    message = 'Нет доступа в интернет или адрес указан неверно.';
  }
  return { reachable: false, empty: false, message };
}

/**
 * Create a private repository through the hosting API, so the wizard can be a
 * single field plus one button.
 * @param options - token, desired name and hosting kind.
 * @returns the new remote URL, or a translated failure.
 */
export async function createRemoteRepository({ token, name, host = 'github' }) {
  const secret = String(token ?? '').trim();
  const repository = String(name ?? '').trim();
  if (secret === '') return { ok: false, message: 'Сначала вставьте токен доступа.' };
  if (repository === '') return { ok: false, message: 'Укажите имя репозитория.' };
  const endpoint = host === 'gitlab' ? 'https://gitlab.com/api/v4/projects' : 'https://api.github.com/user/repos';
  const body = host === 'gitlab'
    ? { name: repository, visibility: 'private' }
    : { name: repository, private: true, auto_init: false };
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'dsh-sync',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, message: `Нет связи с ${host}: ${String(error?.message ?? error)}` };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401) return { ok: false, message: 'Токен не принят. Проверьте, что он скопирован целиком и не истёк.' };
    if (response.status === 403) return { ok: false, message: 'У токена нет права создавать репозитории: включите для него доступ repo.' };
    if (response.status === 422) return { ok: false, message: `Такое имя уже занято или недопустимо (${repository}).` };
    return { ok: false, message: `Хостинг вернул ошибку ${String(response.status)}: ${text.slice(0, 200)}` };
  }
  const created = await response.json().catch(() => ({}));
  const url = host === 'gitlab' ? created?.http_url_to_repo : created?.clone_url;
  if (typeof url !== 'string' || url === '') {
    return { ok: false, message: 'Репозиторий создан, но адрес не получен. Скопируйте адрес вручную.' };
  }
  return { ok: true, url, htmlUrl: typeof created?.html_url === 'string' ? created.html_url : undefined };
}
