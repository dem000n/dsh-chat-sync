/**
 * Browser half of the chat-sync plugin: the page under Settings.
 *
 * It renders one of three screens inside the settings column rather than as a
 * floating overlay, so the plugin lays out in the host's own flow and inherits
 * its scrolling, focus order and theme. All copy lives in the two dictionaries
 * below and is read through the Harness locale service, and every state change
 * goes through the Host over `/dsh-sync/api`.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-chat-sync',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'dsh-sync';

    /** Interface copy. */
    const ru = {
      nav: 'Синхронизация чатов',
      title: 'Синхронизация чатов',
      subtitle: 'Одни и те же диалоги — и приложенные к ним файлы — на всех ваших компьютерах.',
      off: 'Синхронизация не настроена',
      offHint: 'Настройте её на этом компьютере или подключитесь к уже настроенному.',
      createHere: 'Настроить на этом компьютере',
      joinExisting: 'Подключиться к существующей',
      ok: 'Всё синхронизировано',
      localOnly: 'Есть что отправить',
      incomingOnly: 'Есть новые данные с других компьютеров',
      bothWays: 'Есть изменения в обе стороны',
      conflictState: 'Нужно ваше решение',
      busyState: 'Идёт синхронизация…',
      errorState: 'Синхронизация не удалась',
      syncNow: 'Синхронизировать',
      sendOnly: 'Только отправить',
      receiveOnly: 'Только получить',
      refresh: 'Обновить',
      refreshHint: 'Пересчитать файлы на этом компьютере',
      never: 'ещё не было',
      justNow: 'только что',
      minutesAgo: '{{n}} мин назад',
      hoursAgo: '{{n}} ч назад',
      daysAgo: '{{n}} дн назад',
      lastSync: 'Последняя синхронизация',
      thisDevice: 'этот компьютер',
      filesCount: 'файлов: {{n}}',
      pendingCount: 'к отправке: {{n}}',
      incomingCount: 'к получению: {{n}}',
      itemSessions: 'Чаты',
      itemSessionsHint: 'Вся история диалогов: ваши сообщения, ответы и вызовы инструментов.',
      itemAttachments: 'Прикреплённые файлы',
      itemAttachmentsHint: 'Картинки и документы, которые вы прикладывали к чатам.',
      itemSettings: 'Настройки и плагины',
      itemSettingsHint: 'Ваши настройки Harness и список установленных плагинов.',
      itemInstructions: 'Инструкции и навыки',
      itemInstructionsHint: 'Файл AGENTS.md и ваши собственные навыки.',
      sections: 'Что синхронизировать',
      sectionsHint: 'Выключенные разделы остаются только на этом компьютере.',
      devices: 'Компьютеры',
      addDevice: 'Добавить новый ПК',
      addDeviceHint: 'Покажет код, который нужно вставить на другом компьютере.',
      problems: 'Требуется внимание',
      conflicts: 'Одновременно изменённые файлы',
      conflictHint: 'Один и тот же чат продолжили на двух компьютерах. Обе версии сохранены — выберите, какая останется.',
      keepMine: 'Оставить мою версию',
      takeTheirs: 'Взять версию с другого ПК',
      conflictFrom: 'версия с «{{name}}»',
      missingFolders: 'Папки, которых нет на этом компьютере',
      missingFoldersHint: 'Чаты из этих папок перенесены в общую папку. Укажите, где эти папки лежат здесь, — и чаты вернутся на место.',
      pickFolder: 'Указать папку',
      relocated: 'Чаты, перенесённые в общую папку',
      deferred: 'Отложено: чат сейчас открыт',
      oversized: 'Слишком большие файлы (не синхронизируются)',
      settings: 'Настройки синхронизации',
      autoSync: 'Синхронизировать автоматически',
      autoSyncHint: 'В фоне, пока Harness запущен.',
      every: 'каждые',
      minutes: 'минут',
      deviceName: 'Имя этого компьютера',
      deviceNameHint: 'Так он будет называться в списке компьютеров и в истории.',
      language: 'Язык страницы',
      languageHint: 'Русский добавляется как язык DSH; остальные разделы останутся на английском.',
      history: 'История',
      noHistory: 'Пока пусто.',
      storage: 'Хранилище',
      storageGit: 'git-репозиторий',
      storageFolder: 'общая папка',
      branch: 'ветка',
      disconnect: 'Отключить синхронизацию',
      disconnectHint: 'Ничего не удаляется: файлы остаются и здесь, и в хранилище.',
      disconnectConfirm: 'Отключить синхронизацию на этом компьютере? Файлы останутся на месте.',
      needReload: 'Настройки Harness изменились. Перезапустите Harness, чтобы они применились.',
      setupTitle: 'Настройка синхронизации',
      setupIntro: 'Выберите, где будет храниться общая копия. Доступ к ней есть только у вас.',
      whereStore: 'Где хранить',
      kindGit: 'Приватный git-репозиторий',
      kindGitHint: 'GitHub или GitLab. История версий, ничего не теряется, работает через интернет.',
      kindFolder: 'Общая папка',
      kindFolderHint: 'Яндекс.Диск, OneDrive, сетевая папка. Проще всего, но без истории версий.',
      repoAddress: 'Адрес репозитория',
      repoAddressHint: 'Например: https://github.com/ваше-имя/dsh-sync-store.git',
      createRepo: 'Создать приватный репозиторий',
      creatingRepo: 'Создаём…',
      repoName: 'Имя нового репозитория',
      token: 'Токен доступа',
      tokenHint: 'Нужен только для приватного репозитория. Хранится в защищённом хранилище Harness и никогда не попадает в общий репозиторий.',
      tokenLink: 'Создать токен на GitHub',
      tokenSaved: 'Токен уже сохранён',
      checkAddress: 'Проверить адрес',
      checking: 'Проверяем…',
      folderPath: 'Папка',
      folderHint: 'Она должна синхронизироваться между компьютерами облачным сервисом.',
      chooseFolder: 'Выбрать папку',
      deviceNameField: 'Имя этого компьютера',
      enable: 'Включить синхронизацию',
      enabling: 'Включаем…',
      back: 'Назад',
      joinTitle: 'Подключение к существующей синхронизации',
      joinIntro: 'Вставьте код подключения, который показал другой компьютер.',
      pairCode: 'Код подключения',
      pairCodeHint: 'Он выглядит как DSHSYNC1:… и может быть длинным.',
      join: 'Подключиться',
      joining: 'Подключаемся…',
      pairTitle: 'Добавить новый ПК',
      pairStep1: 'Установите этот плагин на новом компьютере — так же, как на этом.',
      pairStep2: 'Откройте там Настройки → Синхронизация чатов.',
      pairStep3: 'Нажмите «Подключиться к существующей» и вставьте код ниже.',
      pairWithToken: 'Включить токен в код',
      pairWithTokenHint: 'Так на новом ПК достаточно вставить один код, но сам код становится секретом.',
      copyCode: 'Скопировать код',
      copied: 'Скопировано',
      copyInstructions: 'Скопировать инструкцию',
      pluginAddress: 'Адрес плагина',
      firstSyncAfterJoin: 'После подключения запустится первая синхронизация.',
      syncDone: 'Готово',
      syncFailed: 'Не удалось',
      appliedCount: 'получено: {{n}}',
      pushedCount: 'отправлено: {{n}}',
      conflictCount: 'конфликтов: {{n}}',
      deferredCount: 'отложено: {{n}}',
      auto: 'автоматически',
      manual: 'вручную',
      startup: 'при запуске',
      gitMissing: 'Git не найден в системе. Установите Git для Windows — без него синхронизация через репозиторий недоступна.',
      errorPrefix: 'Ошибка',
      retry: 'Повторить',
      loading: 'Загрузка…',
      fatal: 'Не удалось загрузить состояние синхронизации.',
      adopt: 'Скачать всё из хранилища',
      adoptHint: 'Полезно на новом компьютере: файлы хранилища станут входящими изменениями.',
      sizeText: '{{size}}',
    };

    /** English copy, key for key. */
    const en = {
      nav: 'Chat sync',
      title: 'Chat sync',
      subtitle: 'The same conversations — and the files attached to them — on all your computers.',
      off: 'Sync is not set up',
      offHint: 'Set it up on this computer, or join a computer that already has it.',
      createHere: 'Set it up on this computer',
      joinExisting: 'Join an existing sync',
      ok: 'Everything is in sync',
      localOnly: 'There is something to send',
      incomingOnly: 'There is new data from other computers',
      bothWays: 'Changes on both sides',
      conflictState: 'Your decision is needed',
      busyState: 'Syncing…',
      errorState: 'The last sync failed',
      syncNow: 'Sync now',
      sendOnly: 'Send only',
      receiveOnly: 'Receive only',
      refresh: 'Refresh',
      refreshHint: 'Recount the files on this computer',
      never: 'never yet',
      justNow: 'just now',
      minutesAgo: '{{n}} min ago',
      hoursAgo: '{{n}} h ago',
      daysAgo: '{{n}} d ago',
      lastSync: 'Last sync',
      thisDevice: 'this computer',
      filesCount: 'files: {{n}}',
      pendingCount: 'to send: {{n}}',
      incomingCount: 'to receive: {{n}}',
      itemSessions: 'Chats',
      itemSessionsHint: 'The whole conversation history: your messages, answers and tool calls.',
      itemAttachments: 'Attached files',
      itemAttachmentsHint: 'Images and documents you attached to chats.',
      itemSettings: 'Settings and plugins',
      itemSettingsHint: 'Your Harness settings and the installed plugin list.',
      itemInstructions: 'Instructions and skills',
      itemInstructionsHint: 'Your AGENTS.md file and your own skills.',
      sections: 'What to sync',
      sectionsHint: 'Disabled sections stay on this computer only.',
      devices: 'Computers',
      addDevice: 'Add a new computer',
      addDeviceHint: 'Shows the code to paste on the other computer.',
      problems: 'Needs attention',
      conflicts: 'Files changed on both sides',
      conflictHint: 'The same chat was continued on two computers. Both versions are kept — choose which one stays.',
      keepMine: 'Keep my version',
      takeTheirs: 'Take the other computer’s version',
      conflictFrom: 'version from “{{name}}”',
      missingFolders: 'Folders missing on this computer',
      missingFoldersHint: 'Chats from these folders were moved to the shared folder. Point at where these folders are here and the chats move back.',
      pickFolder: 'Choose folder',
      relocated: 'Chats moved to the shared folder',
      deferred: 'Deferred: the chat is open right now',
      oversized: 'Files too large to sync',
      settings: 'Sync settings',
      autoSync: 'Sync automatically',
      autoSyncHint: 'In the background while Harness runs.',
      every: 'every',
      minutes: 'minutes',
      deviceName: 'Name of this computer',
      deviceNameHint: 'This is how it appears in the computer list and in the history.',
      language: 'Page language',
      languageHint: 'Russian is added as a DSH language; other sections stay in English.',
      history: 'History',
      noHistory: 'Nothing yet.',
      storage: 'Storage',
      storageGit: 'git repository',
      storageFolder: 'shared folder',
      branch: 'branch',
      disconnect: 'Disconnect sync',
      disconnectHint: 'Nothing is deleted: the files stay here and in the store.',
      disconnectConfirm: 'Disconnect sync on this computer? Files stay where they are.',
      needReload: 'Harness settings changed. Restart Harness for them to take effect.',
      setupTitle: 'Set up sync',
      setupIntro: 'Choose where the shared copy lives. Only you have access to it.',
      whereStore: 'Where to store it',
      kindGit: 'Private git repository',
      kindGitHint: 'GitHub or GitLab. Version history, nothing is lost, works over the internet.',
      kindFolder: 'Shared folder',
      kindFolderHint: 'OneDrive, Dropbox, a network share. Simplest, but without version history.',
      repoAddress: 'Repository address',
      repoAddressHint: 'For example: https://github.com/your-name/dsh-sync-store.git',
      createRepo: 'Create a private repository',
      creatingRepo: 'Creating…',
      repoName: 'New repository name',
      token: 'Access token',
      tokenHint: 'Needed only for a private repository. It is stored in the Harness secret store and never enters the shared repository.',
      tokenLink: 'Create a token on GitHub',
      tokenSaved: 'A token is already saved',
      checkAddress: 'Check the address',
      checking: 'Checking…',
      folderPath: 'Folder',
      folderHint: 'It must be synchronized between computers by a cloud service.',
      chooseFolder: 'Choose folder',
      deviceNameField: 'Name of this computer',
      enable: 'Turn on sync',
      enabling: 'Turning on…',
      back: 'Back',
      joinTitle: 'Join an existing sync',
      joinIntro: 'Paste the connection code shown by the other computer.',
      pairCode: 'Connection code',
      pairCodeHint: 'It looks like DSHSYNC1:… and can be long.',
      join: 'Join',
      joining: 'Joining…',
      pairTitle: 'Add a new computer',
      pairStep1: 'Install this plugin on the new computer, the same way as here.',
      pairStep2: 'Open Settings → Chat sync there.',
      pairStep3: 'Press “Join an existing sync” and paste the code below.',
      pairWithToken: 'Include the token in the code',
      pairWithTokenHint: 'Then one code is enough on the new computer, but the code itself becomes a secret.',
      copyCode: 'Copy the code',
      copied: 'Copied',
      copyInstructions: 'Copy the instructions',
      pluginAddress: 'Plugin address',
      firstSyncAfterJoin: 'The first sync starts right after joining.',
      syncDone: 'Done',
      syncFailed: 'Failed',
      appliedCount: 'received: {{n}}',
      pushedCount: 'sent: {{n}}',
      conflictCount: 'conflicts: {{n}}',
      deferredCount: 'deferred: {{n}}',
      auto: 'automatic',
      manual: 'manual',
      startup: 'at startup',
      gitMissing: 'Git was not found on this system. Install Git for Windows — repository sync needs it.',
      errorPrefix: 'Error',
      retry: 'Retry',
      loading: 'Loading…',
      fatal: 'Could not load the sync state.',
      adopt: 'Download everything from the store',
      adoptHint: 'Useful on a new computer: the store content becomes incoming changes.',
      sizeText: '{{size}}',
    };

    /**
     * Fill `{{name}}` placeholders in one copy string.
     * @param template - the copy.
     * @param values - placeholder values.
     * @returns the filled string.
     */
    function fill(template, values) {
      if (values === undefined) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (values[key] === undefined ? match : String(values[key])));
    }

    /**
     * Human-readable byte size.
     * @param bytes - the size.
     * @returns a short label such as `12,4 МБ`.
     */
    function formatBytes(bytes) {
      const value = Number(bytes) || 0;
      if (value < 1024) return `${String(value)} Б`;
      const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
      let scaled = value / 1024;
      let index = 0;
      while (scaled >= 1024 && index < units.length - 1) {
        scaled /= 1024;
        index += 1;
      }
      return `${scaled.toFixed(scaled < 10 ? 1 : 0)} ${units[index]}`;
    }

    /**
     * Relative time label for a timestamp.
     * @param iso - an ISO timestamp or a millisecond number.
     * @param t - the locale reader.
     * @returns a short relative label.
     */
    function relativeTime(iso, t) {
      if (iso === undefined || iso === null) return t('never');
      const at = typeof iso === 'number' ? iso : Date.parse(iso);
      if (!Number.isFinite(at)) return t('never');
      const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
      if (seconds < 90) return t('justNow');
      const minutes = Math.round(seconds / 60);
      if (minutes < 90) return fill(t('minutesAgo'), { n: minutes });
      const hours = Math.round(minutes / 60);
      if (hours < 36) return fill(t('hoursAgo'), { n: hours });
      return fill(t('daysAgo'), { n: Math.round(hours / 24) });
    }

    /**
     * Call one Host action and unwrap the envelope.
     * @param action - the action name.
     * @param payload - its payload.
     * @returns the action data.
     */
    async function callHost(action, payload) {
      const url = new URL(`dsh-sync/api/${action}`, document.baseURI).href;
      const method = action === 'state' ? 'GET' : 'POST';
      const response = await fetch(url, {
        method,
        cache: 'no-store',
        headers: method === 'GET'
          ? { 'x-dsh-sync': '1' }
          : { 'x-dsh-sync': '1', 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
      });
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`HTTP ${String(response.status)}`);
      }
      if (body?.ok !== true) throw new Error(body?.error?.message ?? `HTTP ${String(response.status)}`);
      return body.data;
    }

    /** Small observable store driving the page. */
    class Controller {
      /** @param deps - the client context pieces the page needs. */
      constructor(deps) {
        this.deps = deps;
        this.listeners = new Set();
        this.draft = {};
        this.snapshot = {
          loading: true,
          status: undefined,
          screen: 'main',
          busy: false,
          message: undefined,
          error: undefined,
          notice: undefined,
          copied: false,
        };
        this.timer = undefined;
      }

      /** @returns the current snapshot. */
      getSnapshot() {
        return this.snapshot;
      }

      /**
       * Subscribe to changes.
       * @param listener - called on every change.
       * @returns the unsubscribe function.
       */
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }

      /**
       * Merge a patch into the snapshot and notify.
       * @param patch - fields to replace.
       */
      patch(patch) {
        this.snapshot = { ...this.snapshot, ...patch };
        for (const listener of this.listeners) listener(this.snapshot);
      }

      /** Load the status document. */
      async refresh() {
        try {
          const status = await callHost('state');
          this.patch({ loading: false, status, error: undefined });
        } catch (error) {
          this.patch({ loading: false, error: String(error?.message ?? error) });
        }
      }

      /**
       * Run one Host action, folding its returned status back in.
       * @param action - the action name.
       * @param payload - its payload.
       * @returns the action data.
       */
      async run(action, payload) {
        this.patch({ busy: true, error: undefined, message: undefined });
        try {
          const data = await callHost(action, payload);
          if (data?.status !== undefined) this.patch({ status: data.status });
          else await this.refresh();
          return data;
        } catch (error) {
          this.patch({ error: String(error?.message ?? error) });
          return undefined;
        } finally {
          this.patch({ busy: false });
        }
      }

      /** Start the periodic refresh that keeps the page honest. */
      start() {
        if (this.timer !== undefined) return;
        this.timer = setInterval(() => {
          if (document.visibilityState === 'visible' && this.snapshot.busy !== true) void this.refresh();
        }, 15000);
      }

      /** Stop the periodic refresh. */
      stop() {
        if (this.timer === undefined) return;
        clearInterval(this.timer);
        this.timer = undefined;
      }
    }

    /* ---------- presentation ---------- */

    const tokens = {
      label: 'var(--dsw-alias-label-primary)',
      labelSecondary: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      borderStrong: 'var(--dsw-alias-border-l2)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      brand: 'var(--dsw-alias-brand-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    };

    const styles = {
      page: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 0 32px' },
      header: { display: 'flex', flexDirection: 'column', gap: '4px' },
      title: { fontSize: '16px', lineHeight: '24px', fontWeight: 600, color: tokens.label },
      subtitle: { fontSize: '13px', lineHeight: '20px', color: tokens.labelSecondary },
      card: {
        border: `1px solid ${tokens.border}`,
        borderRadius: '10px',
        background: tokens.layer1,
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      },
      cardTitle: { fontSize: '13px', lineHeight: '20px', fontWeight: 600, color: tokens.label },
      cardHint: { fontSize: '12px', lineHeight: '18px', color: tokens.labelSecondary },
      hero: { display: 'flex', gap: '12px', alignItems: 'flex-start' },
      dot: (color) => ({
        flex: '0 0 auto',
        width: '12px',
        height: '12px',
        marginTop: '5px',
        borderRadius: '50%',
        background: color,
      }),
      heroTitle: { fontSize: '15px', lineHeight: '22px', fontWeight: 600, color: tokens.label },
      heroText: { fontSize: '12px', lineHeight: '18px', color: tokens.labelSecondary },
      actions: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' },
      button: (variant, disabled) => ({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        height: '32px',
        padding: '0 14px',
        borderRadius: '8px',
        border: variant === 'primary' ? 'none' : `1px solid ${tokens.borderStrong}`,
        background: variant === 'primary'
          ? 'var(--dsw-alias-button-primary-fill)'
          : variant === 'danger'
            ? 'transparent'
            : 'transparent',
        color: variant === 'primary' ? 'var(--dsw-alias-label-primary-foreground)' : variant === 'danger' ? tokens.error : tokens.label,
        fontSize: '13px',
        lineHeight: '20px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }),
      linkButton: {
        border: 'none',
        background: 'transparent',
        color: tokens.brand,
        fontSize: '13px',
        cursor: 'pointer',
        padding: 0,
      },
      row: {
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        padding: '8px 0',
        borderTop: `1px solid ${tokens.border}`,
      },
      rowText: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
      rowTitle: { fontSize: '13px', lineHeight: '20px', color: tokens.label },
      rowHint: { fontSize: '12px', lineHeight: '18px', color: tokens.labelSecondary },
      counts: { fontSize: '12px', lineHeight: '18px', color: tokens.labelSecondary, whiteSpace: 'nowrap' },
      switchTrack: (checked) => ({
        flex: '0 0 auto',
        width: '36px',
        height: '20px',
        padding: '2px',
        borderRadius: '999px',
        border: 'none',
        background: checked ? tokens.brand : tokens.borderStrong,
        cursor: 'pointer',
      }),
      switchThumb: (checked) => ({
        display: 'block',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        background: checked ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-switch-thumb)',
        transform: checked ? 'translateX(16px)' : 'none',
        transition: 'transform 120ms ease',
      }),
      input: {
        width: '100%',
        boxSizing: 'border-box',
        height: '32px',
        padding: '0 10px',
        border: `1px solid ${tokens.borderStrong}`,
        borderRadius: '8px',
        background: tokens.layer1,
        color: tokens.label,
        fontSize: '13px',
        outline: 'none',
      },
      textarea: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '76px',
        padding: '8px 10px',
        border: `1px solid ${tokens.borderStrong}`,
        borderRadius: '8px',
        background: tokens.layer1,
        color: tokens.label,
        fontSize: '12px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        resize: 'vertical',
        outline: 'none',
      },
      field: { display: 'flex', flexDirection: 'column', gap: '4px' },
      fieldLabel: { fontSize: '12px', lineHeight: '18px', color: tokens.label },
      badge: (color) => ({
        fontSize: '11px',
        lineHeight: '16px',
        padding: '0 6px',
        borderRadius: '6px',
        color,
        border: `1px solid ${color}`,
        whiteSpace: 'nowrap',
      }),
      notice: (color) => ({
        border: `1px solid ${color}`,
        borderRadius: '8px',
        padding: '10px 12px',
        fontSize: '12px',
        lineHeight: '18px',
        color: tokens.label,
      }),
      steps: { margin: 0, paddingLeft: '18px', fontSize: '12px', lineHeight: '20px', color: tokens.labelSecondary },
      mono: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: tokens.labelSecondary,
        wordBreak: 'break-all',
      },
      segment: { display: 'inline-flex', border: `1px solid ${tokens.borderStrong}`, borderRadius: '8px', overflow: 'hidden' },
      segmentItem: (active) => ({
        border: 'none',
        padding: '0 12px',
        height: '30px',
        fontSize: '12px',
        cursor: 'pointer',
        background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
        color: active ? tokens.label : tokens.labelSecondary,
      }),
    };

    /**
     * One labelled button.
     * @param props - variant, handler, disabled flag and children.
     * @returns the button element.
     */
    function Button(props) {
      const { variant = 'outline', onClick, disabled = false, title, children } = props;
      return h('button', {
        type: 'button',
        title,
        disabled,
        onClick,
        style: styles.button(variant, disabled),
      }, children);
    }

    /**
     * An accessible on/off switch matching the host's own control.
     * @param props - checked flag and change handler.
     * @returns the switch element.
     */
    function Switch(props) {
      const { checked, onChange, disabled = false, label } = props;
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        disabled,
        onClick: () => onChange(!checked),
        style: { ...styles.switchTrack(checked), opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' },
      }, h('span', { style: styles.switchThumb(checked) }));
    }

    /**
     * A titled card.
     * @param props - title, hint, actions and children.
     * @returns the card element.
     */
    function Card(props) {
      const { title, hint, actions, children } = props;
      return h('section', { style: styles.card },
        title === undefined && actions === undefined
          ? null
          : h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline' } },
            h('div', { style: styles.rowText },
              title === undefined ? null : h('div', { style: styles.cardTitle }, title),
              hint === undefined ? null : h('div', { style: styles.cardHint }, hint)),
            actions),
        children);
    }

    /**
     * One labelled row with a trailing control.
     * @param props - title, hint, trailing content and extra text.
     * @returns the row element.
     */
    function Row(props) {
      const { title, hint, trailing, meta, first = false } = props;
      return h('div', { style: first ? { ...styles.row, borderTop: 'none' } : styles.row },
        h('div', { style: styles.rowText },
          h('div', { style: styles.rowTitle }, title),
          hint === undefined ? null : h('div', { style: styles.rowHint }, hint),
          meta === undefined ? null : h('div', { style: styles.counts }, meta)),
        trailing);
    }

    /**
     * A labelled text field.
     * @param props - label, hint, value and change handler.
     * @returns the field element.
     */
    function Field(props) {
      const { label, hint, value, onChange, type = 'text', placeholder, disabled = false } = props;
      return h('label', { style: styles.field },
        h('span', { style: styles.fieldLabel }, label),
        h('input', {
          type,
          value: value ?? '',
          placeholder,
          disabled,
          spellCheck: false,
          autoComplete: type === 'password' ? 'off' : 'on',
          onChange: (event) => onChange(event.target.value),
          style: { ...styles.input, opacity: disabled ? 0.6 : 1 },
        }),
        hint === undefined ? null : h('span', { style: styles.cardHint }, hint));
    }

    /**
     * The status card: colour, one plain sentence, and the primary action.
     * @param props - the status document, locale reader and controller.
     * @returns the hero element.
     */
    function StatusCard(props) {
      const { status, t, controller } = props;
      const busy = controller.getSnapshot().busy || status.busy;
      const conflicts = status.conflicts?.length ?? 0;
      const pending = status.pending ?? 0;
      const incoming = status.incoming ?? 0;
      let color = tokens.success;
      let title = t('ok');
      let detail = `${t('lastSync')}: ${relativeTime(status.lastSyncAt, t)}`;
      if (status.configured !== true) {
        color = tokens.idle;
        title = t('off');
        detail = t('offHint');
      } else if (busy) {
        color = tokens.brand;
        title = t('busyState');
        detail = status.phaseDetail === '' ? `${t('lastSync')}: ${relativeTime(status.lastSyncAt, t)}` : status.phaseDetail;
      } else if (conflicts > 0) {
        color = tokens.error;
        title = t('conflictState');
        detail = `${String(conflicts)} · ${t('conflictHint')}`;
      } else if (status.lastResult !== undefined && status.lastResult.ok === false) {
        color = tokens.error;
        title = t('errorState');
        detail = status.lastResult.message ?? t('errorPrefix');
      } else if (pending > 0 && incoming > 0) {
        color = tokens.warn;
        title = t('bothWays');
        detail = `${fill(t('pendingCount'), { n: pending })} · ${fill(t('incomingCount'), { n: incoming })}`;
      } else if (pending > 0) {
        color = tokens.warn;
        title = t('localOnly');
        detail = fill(t('pendingCount'), { n: pending });
      } else if (incoming > 0) {
        color = tokens.brand;
        title = t('incomingOnly');
        detail = fill(t('incomingCount'), { n: incoming });
      }

      const rows = [];
      if (status.configured === true) {
        rows.push(h('div', { key: 'meta', style: styles.heroText },
          `${status.device?.name ?? ''} · ${status.store?.kind === 'folder' ? t('storageFolder') : t('storageGit')}`
          + (status.store?.remoteLabel === undefined ? '' : ` · ${status.store.remoteLabel}`)
          + (status.store?.branch === undefined ? '' : ` · ${t('branch')} ${status.store.branch}`)));
      }
      rows.push(h('div', { key: 'actions', style: styles.actions },
        h(Button, {
          variant: 'primary',
          disabled: busy || status.configured !== true,
          onClick: () => void controller.run('sync', { payload: { direction: 'both' } }),
        }, busy ? t('busyState') : t('syncNow')),
        h(Button, {
          disabled: busy || status.configured !== true,
          onClick: () => void controller.run('sync', { payload: { direction: 'push' } }),
        }, t('sendOnly')),
        h(Button, {
          disabled: busy || status.configured !== true,
          onClick: () => void controller.run('sync', { payload: { direction: 'pull' } }),
        }, t('receiveOnly')),
        h(Button, {
          title: t('refreshHint'),
          disabled: busy,
          onClick: () => void controller.run('rescan'),
        }, t('refresh'))));

      return h(Card, null,
        h('div', { style: styles.hero },
          h('span', { style: styles.dot(color) }),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 } },
            h('div', { style: styles.heroTitle }, title),
            h('div', { style: styles.heroText }, detail),
            status.autoSync?.enabled === true
              ? h('div', { style: styles.heroText }, `${t('autoSync')}: ${t('every')} ${String(status.autoSync.minutes)} ${t('minutes')}`)
              : null)),
        ...rows);
    }

    /**
     * The per-section switches.
     * @param props - status, locale reader and controller.
     * @returns the card element.
     */
    function SectionsCard(props) {
      const { status, t, controller } = props;
      const labels = {
        sessions: [t('itemSessions'), t('itemSessionsHint')],
        attachments: [t('itemAttachments'), t('itemAttachmentsHint')],
        settings: [t('itemSettings'), t('itemSettingsHint')],
        instructions: [t('itemInstructions'), t('itemInstructionsHint')],
      };
      return h(Card, { title: t('sections'), hint: t('sectionsHint') },
        (status.items ?? []).map((item, index) => {
          const [label, hint] = labels[item.id] ?? [item.id, undefined];
          const parts = [fill(t('filesCount'), { n: item.files }), formatBytes(item.bytes)];
          if (item.pending > 0) parts.push(fill(t('pendingCount'), { n: item.pending }));
          return h(Row, {
            key: item.id,
            first: index === 0,
            title: label,
            hint,
            meta: parts.join(' · '),
            trailing: h(Switch, {
              checked: item.enabled,
              label,
              disabled: controller.getSnapshot().busy,
              onChange: (next) => void controller.run('items', { payload: { items: { [item.id]: next } } }),
            }),
          });
        }));
    }

    /**
     * Everything that needs a decision, shown only when it exists.
     * @param props - status, locale reader and controller.
     * @returns the card, or null.
     */
    function ProblemsCard(props) {
      const { status, t, controller } = props;
      const conflicts = status.conflicts ?? [];
      const missing = status.missingWorkspacePaths ?? [];
      const relocations = status.relocations ?? [];
      const deferredCount = Number(status.lastResult?.deferred ?? 0);
      const oversized = (status.items ?? []).flatMap((item) => (item.oversized ?? []).map((row) => ({ ...row, item: item.id })));
      const reload = status.lastResult?.needsReload === true;
      if (conflicts.length === 0 && missing.length === 0 && deferredCount === 0 && oversized.length === 0 && reload !== true) return null;

      const children = [];
      if (reload) children.push(h('div', { key: 'reload', style: styles.notice(tokens.warn) }, t('needReload')));
      if (deferredCount > 0) {
        children.push(h('div', { key: 'deferred', style: styles.notice(tokens.idle) }, `${t('deferred')} · ${String(deferredCount)}`));
      }
      if (conflicts.length > 0) {
        children.push(h('div', { key: 'conflicts-title', style: styles.cardTitle }, `${t('conflicts')} · ${String(conflicts.length)}`));
        children.push(h('div', { key: 'conflicts-hint', style: styles.cardHint }, t('conflictHint')));
        for (const conflict of conflicts.slice(0, 12)) {
          children.push(h(Row, {
            key: conflict.id,
            title: conflict.path.split('/').pop(),
            hint: `${conflict.path} · ${fill(t('conflictFrom'), { name: conflict.from })}`,
            trailing: h('div', { style: styles.actions },
              h(Button, {
                disabled: controller.getSnapshot().busy,
                onClick: () => void controller.run('conflict', { payload: { id: conflict.id, action: 'keep-local' } }),
              }, t('keepMine')),
              h(Button, {
                disabled: controller.getSnapshot().busy,
                onClick: () => void controller.run('conflict', { payload: { id: conflict.id, action: 'take-remote' } }),
              }, t('takeTheirs'))),
          }));
        }
      }
      if (missing.length > 0) {
        children.push(h('div', { key: 'missing-title', style: styles.cardTitle }, t('missingFolders')));
        children.push(h('div', { key: 'missing-hint', style: styles.cardHint }, t('missingFoldersHint')));
        for (const entry of missing.slice(0, 12)) {
          children.push(h(Row, {
            key: entry.path,
            title: entry.path,
            trailing: h(Button, {
              disabled: controller.getSnapshot().busy,
              onClick: () => void controller.pickFolderFor(entry.path),
            }, t('pickFolder')),
          }));
        }
      }
      if (relocations.length > 0) {
        children.push(h('div', { key: 'reloc-title', style: styles.cardTitle }, `${t('relocated')} · ${String(relocations.length)}`));
        for (const entry of relocations.slice(0, 8)) {
          children.push(h(Row, { key: entry.sessionId, title: entry.from, hint: `→ ${entry.to}` }));
        }
      }
      if (oversized.length > 0) {
        children.push(h('div', { key: 'big-title', style: styles.cardTitle }, t('oversized')));
        for (const entry of oversized.slice(0, 8)) {
          children.push(h(Row, { key: `${entry.item}:${entry.storeRelPath}`, title: entry.storeRelPath, meta: formatBytes(entry.bytes) }));
        }
      }
      return h(Card, { title: t('problems') }, children);
    }

    /**
     * The computer list.
     * @param props - status, locale reader and controller.
     * @returns the card element.
     */
    function DevicesCard(props) {
      const { status, t, controller } = props;
      const devices = status.devices ?? [];
      return h(Card, {
        title: t('devices'),
        actions: h(Button, {
          disabled: status.configured !== true,
          onClick: () => void controller.openPair(),
        }, t('addDevice')),
      },
      devices.length === 0
        ? h('div', { style: styles.cardHint }, t('noHistory'))
        : devices.map((device, index) => h(Row, {
          key: device.id,
          first: index === 0,
          title: device.name,
          hint: device.platform,
          meta: `${t('lastSync')}: ${relativeTime(device.lastSyncAt, t)}`,
          trailing: device.isThisDevice === true
            ? h('span', { style: styles.badge(tokens.brand) }, t('thisDevice'))
            : null,
        })),
      h('div', { style: styles.cardHint }, t('addDeviceHint')));
    }

    /**
     * Auto-sync, device name, language and the disconnect action.
     * @param props - status, locale reader and controller.
     * @returns the card element.
     */
    function SettingsCard(props) {
      const { status, t, controller } = props;
      return h(Card, { title: t('settings') },
        h(Row, {
          first: true,
          title: t('autoSync'),
          hint: t('autoSyncHint'),
          trailing: h(Switch, {
            checked: status.autoSync?.enabled === true,
            label: t('autoSync'),
            onChange: (next) => void controller.run('autoSync', { payload: { enabled: next, minutes: status.autoSync?.minutes } }),
          }),
        }),
        status.autoSync?.enabled === true
          ? h(Row, {
            title: `${t('every')} ${String(status.autoSync.minutes)} ${t('minutes')}`,
            trailing: h('div', { style: styles.actions },
              ...[5, 15, 30, 60].map((minutes) => h(Button, {
                key: minutes,
                disabled: status.autoSync.minutes === minutes,
                onClick: () => void controller.run('autoSync', { payload: { enabled: true, minutes } }),
              }, String(minutes)))),
          })
          : null,
        h(Row, {
          title: t('deviceName'),
          hint: t('deviceNameHint'),
          trailing: null,
        }),
        h('input', {
          value: controller.draft.deviceName ?? status.device?.name ?? '',
          onChange: (event) => controller.setDraft({ deviceName: event.target.value }),
          onBlur: () => {
            const value = controller.draft.deviceName;
            if (typeof value === 'string' && value.trim() !== '' && value !== status.device?.name) {
              void controller.run('deviceName', { payload: { name: value } });
            }
          },
          style: styles.input,
          spellCheck: false,
        }),
        h(Row, {
          title: t('language'),
          hint: t('languageHint'),
          trailing: h('div', { style: styles.segment },
            h('button', {
              type: 'button',
              style: styles.segmentItem(controller.localeId() === 'ru'),
              onClick: () => controller.setLanguage('ru'),
            }, 'Русский'),
            h('button', {
              type: 'button',
              style: styles.segmentItem(controller.localeId() !== 'ru'),
              onClick: () => controller.setLanguage('en'),
            }, 'English')),
        }),
        h(Row, {
          title: t('disconnect'),
          hint: t('disconnectHint'),
          trailing: h(Button, {
            variant: 'danger',
            disabled: status.configured !== true,
            onClick: () => {
              const answer = controller.deps.confirm?.(t('disconnectConfirm'));
              if (answer === false) return;
              void controller.run('disconnect');
            },
          }, t('disconnect')),
        }));
    }

    /**
     * The last few sync attempts.
     * @param props - status and locale reader.
     * @returns the card element.
     */
    function HistoryCard(props) {
      const { status, t } = props;
      const history = status.history ?? [];
      return h(Card, { title: t('history') },
        history.length === 0
          ? h('div', { style: styles.cardHint }, t('noHistory'))
          : history.map((entry, index) => {
            const parts = [relativeTime(entry.at, t), entry.trigger === 'auto' ? t('auto') : entry.trigger === 'startup' ? t('startup') : t('manual')];
            if (entry.ok === true) {
              parts.push(fill(t('appliedCount'), { n: entry.applied ?? 0 }));
              parts.push(fill(t('pushedCount'), { n: entry.pushed ?? 0 }));
              if ((entry.conflicts ?? 0) > 0) parts.push(fill(t('conflictCount'), { n: entry.conflicts }));
              if ((entry.deferred ?? 0) > 0) parts.push(fill(t('deferredCount'), { n: entry.deferred }));
            } else {
              parts.push(`${t('syncFailed')}: ${entry.message ?? ''}`);
            }
            return h(Row, {
              key: `${entry.at}-${String(index)}`,
              first: index === 0,
              title: entry.ok === true ? t('syncDone') : t('syncFailed'),
              hint: entry.ok === true ? undefined : entry.message,
              meta: parts.join(' · '),
            });
          }));
    }

    /**
     * The state where nothing is configured yet.
     * @param props - locale reader and controller.
     * @returns the card element.
     */
    function WelcomeCard(props) {
      const { t, controller } = props;
      return h(Card, { title: t('setupTitle'), hint: t('setupIntro') },
        h('div', { style: styles.actions },
          h(Button, { variant: 'primary', onClick: () => controller.openWizard('create') }, t('createHere')),
          h(Button, { onClick: () => controller.openWizard('join') }, t('joinExisting'))));
    }

    /**
     * The setup wizard: one screen, filled top to bottom, no separate steps.
     * @param props - status, locale reader and controller.
     * @returns the wizard element.
     */
    function WizardScreen(props) {
      const { status, t, controller } = props;
      const draft = controller.draft;
      const mode = draft.mode;
      const children = [
        h('div', { key: 'head', style: styles.header },
          h('div', { style: styles.title }, mode === 'join' ? t('joinTitle') : t('setupTitle')),
          h('div', { style: styles.subtitle }, mode === 'join' ? t('joinIntro') : t('setupIntro'))),
      ];

      if (status.gitAvailable === false && mode !== 'join') {
        children.push(h('div', { key: 'nogit', style: styles.notice(tokens.warn) }, t('gitMissing')));
      }

      if (mode === 'join') {
        children.push(h(Card, { key: 'code' },
          h('label', { style: styles.field },
            h('span', { style: styles.fieldLabel }, t('pairCode')),
            h('textarea', {
              value: draft.code ?? '',
              onChange: (event) => controller.setDraft({ code: event.target.value }),
              style: styles.textarea,
              spellCheck: false,
              placeholder: 'DSHSYNC1:…',
            }),
            h('span', { style: styles.cardHint }, t('pairCodeHint'))),
          h(Field, {
            label: t('token'),
            hint: draft.codeHasToken === true ? t('tokenSaved') : t('tokenHint'),
            type: 'password',
            value: draft.token ?? '',
            onChange: (value) => controller.setDraft({ token: value }),
          }),
          h(Field, {
            label: t('deviceNameField'),
            value: draft.deviceName ?? status.device?.name ?? '',
            onChange: (value) => controller.setDraft({ deviceName: value }),
          }),
          h('div', { style: styles.cardHint }, t('firstSyncAfterJoin'))));
      } else {
        children.push(h(Card, { key: 'where', title: t('whereStore') },
          h('div', { style: styles.actions },
            h('div', { style: styles.segment },
              h('button', {
                type: 'button',
                style: styles.segmentItem(draft.kind !== 'folder'),
                onClick: () => controller.setDraft({ kind: 'git' }),
              }, t('kindGit')),
              h('button', {
                type: 'button',
                style: styles.segmentItem(draft.kind === 'folder'),
                onClick: () => controller.setDraft({ kind: 'folder' }),
              }, t('kindFolder'))),
            h('div', { style: styles.cardHint }, draft.kind === 'folder' ? t('kindFolderHint') : t('kindGitHint')))));
        if (draft.kind === 'folder') {
          children.push(h(Card, { key: 'folder' },
            h(Field, {
              label: t('folderPath'),
              hint: t('folderHint'),
              value: draft.folder ?? '',
              onChange: (value) => controller.setDraft({ folder: value }),
            }),
            h('div', { style: styles.actions },
              h(Button, { onClick: () => void controller.chooseFolder() }, t('chooseFolder')))));
        } else {
          children.push(h(Card, { key: 'repo' },
            h(Field, {
              label: t('repoAddress'),
              hint: t('repoAddressHint'),
              value: draft.remote ?? '',
              onChange: (value) => controller.setDraft({ remote: value }),
            }),
            h('div', { style: styles.actions },
              h(Button, {
                disabled: controller.getSnapshot().busy || (draft.remote ?? '') === '',
                onClick: () => void controller.checkRemote(),
              }, controller.getSnapshot().busy ? t('checking') : t('checkAddress')),
              draft.checkResult === undefined
                ? null
                : h('span', {
                  style: { ...styles.badge(draft.checkOk === true ? tokens.success : tokens.error) },
                }, draft.checkOk === true ? '✓' : '✕')),
            draft.checkMessage === undefined ? null : h('div', { style: styles.cardHint }, draft.checkMessage),
            h('div', { style: { ...styles.row, borderTop: `1px solid ${tokens.border}` } },
              h('div', { style: styles.rowText },
                h('div', { style: styles.rowTitle }, t('createRepo')),
                h('div', { style: styles.rowHint }, t('tokenHint'))),
              null),
            h(Field, {
              label: t('repoName'),
              value: draft.repositoryName ?? 'dsh-sync-store',
              onChange: (value) => controller.setDraft({ repositoryName: value }),
            }),
            h(Field, {
              label: t('token'),
              hint: status.token?.configured === true ? t('tokenSaved') : undefined,
              type: 'password',
              value: draft.token ?? '',
              onChange: (value) => controller.setDraft({ token: value }),
            }),
            h('div', { style: styles.actions },
              h(Button, { onClick: () => void controller.createRepository() }, t('createRepo')),
              h('a', {
                href: 'https://github.com/settings/tokens/new?scopes=repo&description=DSH%20Sync',
                target: '_blank',
                rel: 'noreferrer',
                style: styles.linkButton,
              }, t('tokenLink')))));
        }
        children.push(h(Card, { key: 'items', title: t('sections'), hint: t('sectionsHint') },
          SECTION_ORDER.map((id, index) => h(Row, {
            key: id,
            first: index === 0,
            title: sectionLabel(id, t),
            hint: sectionHint(id, t),
            trailing: h(Switch, {
              checked: draft.items?.[id] !== false,
              label: sectionLabel(id, t),
              onChange: (next) => controller.setDraft({ items: { ...(draft.items ?? {}), [id]: next } }),
            }),
          }))));
      }

      children.push(h('div', { key: 'actions', style: styles.actions },
        h(Button, {
          variant: 'primary',
          disabled: controller.getSnapshot().busy,
          onClick: () => void controller.submitWizard(),
        }, controller.getSnapshot().busy ? (mode === 'join' ? t('joining') : t('enabling')) : (mode === 'join' ? t('join') : t('enable'))),
        h(Button, { onClick: () => controller.goHome() }, t('back'))));

      return h('div', { style: styles.page }, children);
    }

    /** Order the sections appear in, matching the host's own ordering style. */
    const SECTION_ORDER = ['sessions', 'attachments', 'settings', 'instructions'];

    /**
     * Section title copy.
     * @param id - the section id.
     * @param t - the locale reader.
     * @returns the label.
     */
    function sectionLabel(id, t) {
      return { sessions: t('itemSessions'), attachments: t('itemAttachments'), settings: t('itemSettings'), instructions: t('itemInstructions') }[id] ?? id;
    }

    /**
     * Section description copy.
     * @param id - the section id.
     * @param t - the locale reader.
     * @returns the description.
     */
    function sectionHint(id, t) {
      return {
        sessions: t('itemSessionsHint'),
        attachments: t('itemAttachmentsHint'),
        settings: t('itemSettingsHint'),
        instructions: t('itemInstructionsHint'),
      }[id];
    }

    /**
     * The connection-code screen for a new computer.
     * @param props - status, locale reader and controller.
     * @returns the screen element.
     */
    function PairScreen(props) {
      const { status, t, controller } = props;
      const draft = controller.draft;
      return h('div', { style: styles.page },
        h('div', { style: styles.header },
          h('div', { style: styles.title }, t('pairTitle')),
          h('div', { style: styles.subtitle }, status.store?.remoteLabel ?? status.store?.dir ?? '')),
        h(Card, null,
          h('label', { style: styles.field },
            h('span', { style: styles.fieldLabel }, t('pairCode')),
            h('textarea', {
              readOnly: true,
              value: draft.code ?? '',
              style: styles.textarea,
              onFocus: (event) => event.target.select(),
            })),
          h('div', { style: styles.actions },
            h(Button, { variant: 'primary', onClick: () => void controller.copyCode() }, draft.copied === true ? t('copied') : t('copyCode')),
            h(Button, { onClick: () => void controller.copyInstructions() }, t('copyInstructions'))),
          h(Row, {
            title: t('pairWithToken'),
            hint: t('pairWithTokenHint'),
            trailing: h(Switch, {
              checked: draft.withToken === true,
              label: t('pairWithToken'),
              onChange: (next) => void controller.setWithToken(next),
            }),
          })),
        h(Card, { title: t('addDevice') },
          h('ol', { style: styles.steps },
            h('li', null, t('pairStep1')),
            h('li', null, t('pairStep2')),
            h('li', null, t('pairStep3')))),
        h('div', { style: styles.actions },
          h(Button, { onClick: () => controller.goHome() }, t('back'))));
    }

    /**
     * The page itself.
     * @param props - the injected controller and locale reader.
     * @returns the page element.
     */
    function SyncPage(props) {
      const { controller, t } = props;
      const snapshot = useControllerFallback(controller);

      React.useEffect(() => {
        controller.start();
        void controller.refresh();
        return () => controller.stop();
      }, [controller]);

      const status = snapshot.status;
      if (snapshot.screen === 'pair') return h(PairScreen, { status: status ?? {}, t, controller });
      if (snapshot.screen === 'wizard') return h(WizardScreen, { status: status ?? {}, t, controller });
      if (status === undefined) {
        return h('div', { style: styles.page }, h('div', { style: styles.cardHint }, snapshot.loading ? t('loading') : t('fatal')));
      }
      return h('div', { style: styles.page },
        h('div', { style: styles.header },
          h('div', { style: styles.title }, t('title')),
          h('div', { style: styles.subtitle }, t('subtitle'))),
        snapshot.error === undefined ? null : h('div', { style: styles.notice(tokens.error) }, `${t('errorPrefix')}: ${snapshot.error}`),
        h(StatusCard, { status, t, controller }),
        status.configured === true ? null : h(WelcomeCard, { t, controller }),
        status.configured === true ? h(SectionsCard, { status, t, controller }) : null,
        status.configured === true ? h(ProblemsCard, { status, t, controller }) : null,
        status.configured === true ? h(DevicesCard, { status, t, controller }) : null,
        status.configured === true ? h(SettingsCard, { status, t, controller }) : null,
        status.configured === true ? h(HistoryCard, { status, t }) : null);
    }

    /**
     * Subscribe to the controller's snapshot.
     * @param controller - the page controller.
     * @returns the current snapshot.
     */
    function useControllerFallback(controller) {
      const [snapshot, setSnapshot] = React.useState(controller.getSnapshot());
      React.useEffect(() => controller.subscribe(setSnapshot), [controller]);
      return snapshot;
    }

    /** Required client services. The folder picker is used when available. */
    const inject = ['slots', 'locale'];

    /**
     * Mount the settings page and wire the controller to the client services.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const registered = [];
        try {
          registered.push(ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' }));
        } catch {
          // Another plugin already contributes Russian: reuse it.
        }
        registered.push(ctx.locale.register(NS, 'ru', ru));
        registered.push(ctx.locale.register(NS, 'en', en));
        registered.push(ctx.locale.register(NS, 'zh', en));
        return () => {
          for (const dispose of registered.reverse()) {
            if (typeof dispose === 'function') dispose();
          }
        };
      }, 'dsh-sync: dictionaries');

      const t = ctx.locale.bind(NS);
      const controller = new Controller({
        confirm: (message) => window.confirm(message),
      });
      controller.draft = {
        mode: 'create',
        kind: 'git',
        items: {
          sessions: true,
          attachments: true,
          settings: true,
          instructions: true,
        },
        copied: false,
        withToken: false,
      };
      controller.deps.t = t;
      /** @param patch - draft fields to merge. */
      controller.setDraft = (patch) => {
        controller.draft = { ...controller.draft, ...patch };
        controller.patch({});
      };
      /** @returns the active locale id. */
      controller.localeId = () => {
        try {
          return ctx.locale.getLocale()?.id ?? 'en';
        } catch {
          return 'en';
        }
      };
      /** @param id - the locale to activate. */
      controller.setLanguage = (id) => {
        try {
          ctx.locale.setLocale(id);
        } catch {
          /* an unavailable locale simply keeps the current copy */
        }
        controller.patch({});
      };
      /** @param mode - `create` or `join`. */
      controller.openWizard = (mode) => {
        controller.draft = { ...controller.draft, mode, checkResult: undefined, checkMessage: undefined };
        controller.patch({ screen: 'wizard' });
      };
      controller.goHome = () => controller.patch({ screen: 'main' });

      /** Ask the running workspace registry to include a chat in a folder. */
      controller.pickFolderFor = async (workspacePath) => {
        const picked = await pickDirectory();
        if (picked === null) return;
        await controller.run('pathMapping', { payload: { workspacePath, localPath: picked } });
      };

      /** Pick the shared folder for the folder transport. */
      controller.chooseFolder = async () => {
        const picked = await pickDirectory();
        if (picked === null) return;
        controller.setDraft({ folder: picked });
      };

      /**
       * Open the host's own folder picker.
       * @returns the chosen absolute path, or null.
       */
      async function pickDirectory() {
        const uiWorkspace = ctx.get('uiWorkspace');
        if (uiWorkspace === undefined || typeof uiWorkspace.pickDirectory !== 'function') {
          controller.patch({ error: 'Выбор папки недоступен в этой сборке Harness' });
          return null;
        }
        try {
          return (await uiWorkspace.pickDirectory()) ?? null;
        } catch (error) {
          controller.patch({ error: String(error?.message ?? error) });
          return null;
        }
      }

      /** Verify the typed repository address before anything is written. */
      controller.checkRemote = async () => {
        const data = await controller.run('prepareRemote', {
          payload: { remote: controller.draft.remote, token: controller.draft.token, create: false },
        });
        if (data === undefined) return;
        controller.setDraft({
          checkResult: data.ok === true ? 'ok' : 'fail',
          checkOk: data.ok === true,
          checkMessage: data.ok === true ? (data.label ?? '') : data.message,
          remote: data.ok === true ? data.remote : controller.draft.remote,
        });
      };

      /** Create the private repository through the hosting API. */
      controller.createRepository = async () => {
        const data = await controller.run('prepareRemote', {
          payload: {
            create: true,
            token: controller.draft.token,
            repositoryName: controller.draft.repositoryName ?? 'dsh-sync-store',
          },
        });
        if (data === undefined) return;
        if (data.ok === true) controller.setDraft({ remote: data.remote, checkOk: true, checkResult: 'ok', checkMessage: data.label });
        else controller.setDraft({ checkOk: false, checkResult: 'fail', checkMessage: data.message });
      };

      /** Finish either wizard by writing the settings and syncing once. */
      controller.submitWizard = async () => {
        const draft = controller.draft;
        const payload = draft.mode === 'join'
          ? { code: draft.code, token: draft.token, deviceName: draft.deviceName, copy: controller.localeId() }
          : {
            kind: draft.kind === 'folder' ? 'folder' : 'git',
            remote: draft.remote,
            folder: draft.folder,
            token: draft.token,
            deviceName: draft.deviceName,
            items: draft.items,
            copy: controller.localeId(),
          };
        const data = await controller.run(draft.mode === 'join' ? 'join' : 'setup', { payload });
        if (data === undefined) return;
        if (data.ok === false) {
          controller.patch({ error: data.message });
          return;
        }
        controller.patch({ screen: 'main' });
        await controller.run('sync', { payload: { direction: 'both' } });
      };

      /** Show the pairing code for a new computer. */
      controller.openPair = async () => {
        controller.patch({ screen: 'pair' });
        const data = await controller.run('pair', { payload: { withToken: controller.draft.withToken === true } });
        if (data !== undefined && data.ok !== false) controller.setDraft({ code: data.code });
      };

      /** Re-request the code with or without the token inside it. */
      controller.setWithToken = async (withToken) => {
        controller.draft = { ...controller.draft, withToken };
        const data = await controller.run('pair', { payload: { withToken } });
        if (data !== undefined && data.ok !== false) controller.setDraft({ code: data.code });
      };

      /**
       * Copy text to the clipboard, reporting success in the button label.
       * @param text - the text to copy.
       * @param mark - the draft flag to set on success.
       */
      async function copyText(text, mark) {
        try {
          await navigator.clipboard.writeText(text);
          controller.setDraft({ [mark]: true });
          setTimeout(() => controller.setDraft({ [mark]: false }), 2000);
        } catch {
          controller.patch({ error: 'Clipboard is unavailable' });
        }
      }

      controller.copyCode = () => copyText(controller.draft.code ?? '', 'copied');
      controller.copyInstructions = () => copyText(
        [
          t('pairTitle'),
          `1. ${t('pairStep1')}`,
          `2. ${t('pairStep2')}`,
          `3. ${t('pairStep3')}`,
          '',
          `${t('pairCode')}:`,
          controller.draft.code ?? '',
        ].join('\n'),
        'copied',
      );

      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-sync',
        order: 60,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ controller, t }),
      }, SyncPage)), 'dsh-sync: settings page');
    }

    return { inject, apply };
  },
});
