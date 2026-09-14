export type ClientGuide = {
  id: string;
  name: string;
  mode: string;
  intro: string;
  steps: string[];
  config?: string;
  configLabel?: string;
  note?: string;
  check: string;
  sources: { label: string; url: string }[];
};

export const mcpUrl = 'https://mcp.ohmy-seo.ru/mcp';
const headers = { Authorization: 'Bearer YOUR_API_KEY' };
const json = (value: unknown) => JSON.stringify(value, null, 2);
export const desktopConfig = json({ mcpServers: { 'ohmy-seo': {
  command: 'npx',
  args: ['-y', 'mcp-remote', mcpUrl, '--transport', 'http-only', '--header', 'Authorization:${OHMY_SEO_AUTH}'],
  env: { OHMY_SEO_AUTH: 'Bearer YOUR_API_KEY' },
} } });
const codexConfig = '[mcp_servers.ohmy-seo]\nurl = "https://mcp.ohmy-seo.ru/mcp"\nbearer_token_env_var = "OHMY_SEO_API_KEY"';

export const clientGuides: ClientGuide[] = [
  {
    id: 'claude-desktop', name: 'Claude Desktop', mode: 'Через локальный мост',
    intro: 'Для настольного Claude на macOS и Windows: локальный процесс mcp-remote передаёт запросы в облачный ohmy-seo. Собирать наши пакеты для этого не нужно.',
    steps: ['Установите Node.js LTS и убедитесь, что команда npx доступна на компьютере с Claude.', 'Откройте локальную MCP-конфигурацию Claude Desktop: файл claude_desktop_config.json. На macOS он находится в ~/Library/Application Support/Claude/, на Windows — в %APPDATA%\\Claude\\.', 'Добавьте ohmy-seo в объект mcpServers, замените YOUR_API_KEY ключом из кабинета и сохраните файл. Если серверы уже настроены, сохраните их записи.', 'Полностью закройте Claude Desktop, запустите заново и включите ohmy-seo в инструментах чата.'],
    config: desktopConfig, configLabel: 'claude_desktop_config.json',
    note: 'mcp-remote — сторонний локальный мост; npx скачает его при первом запуске. Эта настройка относится к локальным MCP Claude Desktop, а не к веб-коннекторам или Cowork. На Windows при ошибке запуска npx используйте npx.cmd.',
    check: 'Попросите показать аккаунты через ohmy-seo. Если сервер не появился, проверьте JSON, доступность npx и журнал локального MCP.',
    sources: [{ label: 'Локальные MCP в Claude Desktop', url: 'https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop' }, { label: 'Документация mcp-remote', url: 'https://github.com/punkpeye/mcp-remote' }],
  },
  {
    id: 'claude-code', name: 'Claude Code', mode: 'Прямое HTTP-подключение',
    intro: 'Добавьте облачный сервер командой Claude Code. Область user делает подключение доступным в ваших проектах на этой машине.',
    steps: ['Установите Claude Code и откройте терминал.', 'Замените YOUR_API_KEY в шаблоне и выполните команду. Ключ может сохраниться в истории терминала.', 'Откройте новую сессию Claude Code.'],
    config: 'claude mcp add --transport http --scope user ohmy-seo https://mcp.ohmy-seo.ru/mcp --header "Authorization: Bearer YOUR_API_KEY"', configLabel: 'Терминал',
    check: 'Выполните claude mcp list, затем откройте /mcp в чате. ohmy-seo должен быть подключён.',
    sources: [{ label: 'MCP в Claude Code', url: 'https://code.claude.com/docs/en/mcp' }],
  },
  {
    id: 'codex', name: 'Codex', mode: 'Прямое HTTP-подключение',
    intro: 'Настройка для локального Codex CLI и клиентов, использующих его config.toml. Ключ передаётся через переменную окружения.',
    steps: ['Задайте OHMY_SEO_API_KEY со значением ключа в окружении процесса Codex. В macOS/Linux для текущего терминала: export OHMY_SEO_API_KEY="YOUR_API_KEY". В PowerShell: $env:OHMY_SEO_API_KEY="YOUR_API_KEY".', 'Добавьте блок ниже в ~/.codex/config.toml; на Windows — в .codex/config.toml внутри домашней папки пользователя. Не дублируйте существующий блок ohmy-seo.', 'Перезапустите клиент из окружения, в котором доступна переменная. Для приложения, запущенного через иконку, переменная из терминала может быть недоступна.'],
    config: codexConfig, configLabel: '~/.codex/config.toml',
    note: 'Альтернатива редактированию файла: codex mcp add ohmy-seo --url https://mcp.ohmy-seo.ru/mcp --bearer-token-env-var OHMY_SEO_API_KEY. Это настройка локального клиента, не автоматическая настройка Codex cloud.',
    check: 'Выполните codex mcp list и откройте /mcp в новой сессии. Затем запросите список аккаунтов.',
    sources: [{ label: 'MCP в Codex', url: 'https://developers.openai.com/codex/mcp' }],
  },
  {
    id: 'bb', name: 'BB', mode: 'Через выбранный провайдер',
    intro: 'Для потока BB с провайдером Codex подключение настраивается на машине исполнения агента. При удалённой работе это может быть другой компьютер.',
    steps: ['Определите машину исполнения и профиль Codex, выбранные для потока BB.', 'Добавьте блок ниже в config.toml используемого профиля Codex на этой машине. Для стандартного профиля это ~/.codex/config.toml.', 'Задайте OHMY_SEO_API_KEY в окружении машины/процесса, из которого BB запускает Codex. Переменная в отдельном терминале не меняет окружение уже запущенного BB.', 'Начните новую сессию с этим профилем. Для провайдера Claude Code используйте его вкладку и настройки на той же машине исполнения.'],
    config: codexConfig, configLabel: 'config.toml профиля Codex',
    note: 'Если конфигурацией MCP управляет отдельный плагин или профиль BB, добавляйте сервер там: настройки другого пользователя или профиля не попадут в текущего агента.',
    check: 'Попросите агента BB показать доступные инструменты ohmy-seo и аккаунты. Проверяйте результат в самом потоке, а не только в отдельном терминале.',
    sources: [{ label: 'Формат MCP-конфигурации Codex', url: 'https://developers.openai.com/codex/mcp' }],
  },
  {
    id: 'cursor', name: 'Cursor', mode: 'Прямое HTTP-подключение',
    intro: 'Удалённый сервер добавляется в MCP-конфигурацию Cursor.',
    steps: ['Откройте ~/.cursor/mcp.json для личной настройки во всех проектах или .cursor/mcp.json в нужном проекте.', 'Добавьте запись ниже в mcpServers и замените YOUR_API_KEY своим ключом.', 'Обновите список MCP в настройках Cursor и включите ohmy-seo для агента.'],
    config: json({ mcpServers: { 'ohmy-seo': { url: mcpUrl, headers } } }), configLabel: '~/.cursor/mcp.json',
    note: 'Файл с настоящим ключом не добавляйте в Git. Cursor также поддерживает подстановку ${env:OHMY_SEO_API_KEY} вместо значения ключа, если переменная доступна процессу приложения.',
    check: 'В настройках MCP проверьте состояние сервера и список инструментов, затем запросите аккаунты в чате агента.',
    sources: [{ label: 'MCP в Cursor', url: 'https://cursor.com/docs/mcp' }],
  },
  {
    id: 'windsurf', name: 'Windsurf', mode: 'Прямое HTTP-подключение',
    intro: 'В Cascade используется свой файл MCP-настроек с адресом удалённого сервера.',
    steps: ['Откройте настройки MCP в Cascade или файл ~/.codeium/windsurf/mcp_config.json.', 'Добавьте запись ohmy-seo и замените YOUR_API_KEY ключом из кабинета.', 'Обновите подключение и включите нужные инструменты в Cascade.'],
    config: json({ mcpServers: { 'ohmy-seo': { serverUrl: mcpUrl, headers } } }), configLabel: '~/.codeium/windsurf/mcp_config.json',
    note: 'Вместо ключа поддерживается ${env:OHMY_SEO_API_KEY}, если переменная задана для процесса Windsurf. Не публикуйте личную конфигурацию с ключом.',
    check: 'Убедитесь, что ohmy-seo подключён, и попросите Cascade перечислить доступные аккаунты.',
    sources: [{ label: 'MCP в Cascade', url: 'https://docs.windsurf.com/windsurf/cascade/mcp' }],
  },
  {
    id: 'cline', name: 'Cline', mode: 'Прямое HTTP-подключение',
    intro: 'Выберите именно Streamable HTTP. Старый транспорт SSE для этого шаблона не нужен.',
    steps: ['Откройте раздел MCP Servers в Cline и редактор конфигурации MCP.', 'Добавьте блок ohmy-seo в mcpServers. Замените YOUR_API_KEY и сохраните файл.', 'Включите сервер. Оставьте автоматическое одобрение пустым, чтобы проверять запросы на действия.'],
    config: json({ mcpServers: { 'ohmy-seo': { type: 'streamableHttp', url: mcpUrl, headers, disabled: false, autoApprove: [] } } }), configLabel: 'MCP-конфигурация Cline',
    check: 'Проверьте подключение в MCP Servers. В чате выполните первый запрос на список аккаунтов.',
    sources: [{ label: 'MCP в Cline', url: 'https://docs.cline.bot/mcp/mcp-overview' }],
  },
  {
    id: 'vscode', name: 'VS Code / Copilot', mode: 'Прямое HTTP-подключение',
    intro: 'Для чата агента в VS Code. Редактор запросит ключ отдельно — его не нужно вписывать в JSON.',
    steps: ['В палитре команд выполните MCP: Open User Configuration или откройте .vscode/mcp.json проекта.', 'Добавьте servers и inputs из шаблона, сохранив существующие записи.', 'Запустите ohmy-seo из редактора MCP-конфигурации, подтвердите доверие серверу и введите ключ в запросе VS Code.'],
    config: json({ inputs: [{ type: 'promptString', id: 'ohmy-seo-key', description: 'API-ключ ohmy-seo', password: true }], servers: { 'ohmy-seo': { type: 'http', url: mcpUrl, headers: { Authorization: 'Bearer ${input:ohmy-seo-key}' } } } }), configLabel: 'mcp.json в VS Code',
    note: 'Этот вариант с интерактивным вводом относится к агенту расширения VS Code. Для сессий Agent Host конфигурации с inputs не пересылаются; используйте поддерживаемую этим режимом отдельную настройку.',
    check: 'Выполните MCP: List Servers, проверьте ohmy-seo и включите его инструменты в чате агента.',
    sources: [{ label: 'Подключение MCP в VS Code', url: 'https://code.visualstudio.com/docs/agent-customization/mcp-servers' }, { label: 'Схема mcp.json', url: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration' }],
  },
  {
    id: 'opencode', name: 'OpenCode', mode: 'Прямое HTTP-подключение',
    intro: 'В OpenCode используется раздел mcp, а авторизация OAuth для нашего API-ключа отключается.',
    steps: ['Откройте opencode.json проекта или свою пользовательскую конфигурацию OpenCode.', 'Добавьте блок ниже. Замените YOUR_API_KEY, сохраните файл вне публичного доступа.', 'Перезапустите OpenCode.'],
    config: json({ $schema: 'https://opencode.ai/config.json', mcp: { 'ohmy-seo': { type: 'remote', url: mcpUrl, oauth: false, headers } } }), configLabel: 'opencode.json',
    note: 'Для хранения ключа в окружении замените YOUR_API_KEY на {env:OHMY_SEO_API_KEY}. Переменная должна быть доступна процессу OpenCode.',
    check: 'Выполните opencode mcp list, затем запросите аккаунты в чате.',
    sources: [{ label: 'MCP в OpenCode', url: 'https://opencode.ai/docs/mcp-servers/' }],
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', mode: 'Прямое HTTP-подключение',
    intro: 'В Gemini CLI для Streamable HTTP используется поле httpUrl.',
    steps: ['Откройте ~/.gemini/settings.json или настройки .gemini/settings.json проекта.', 'Добавьте запись ohmy-seo в mcpServers и замените YOUR_API_KEY.', 'Перезапустите Gemini CLI.'],
    config: json({ mcpServers: { 'ohmy-seo': { httpUrl: mcpUrl, headers, timeout: 60000 } } }), configLabel: '~/.gemini/settings.json',
    note: 'Не заменяйте httpUrl на url: в Gemini CLI поле url относится к транспорту SSE. Не публикуйте файл с ключом.',
    check: 'Откройте /mcp в сессии Gemini CLI и проверьте обнаруженные инструменты.',
    sources: [{ label: 'MCP в Gemini CLI', url: 'https://geminicli.com/docs/tools/mcp-server/' }],
  },
  {
    id: 'chatgpt', name: 'ChatGPT Web', mode: 'Прямое подключение пока недоступно',
    intro: 'Веб-коннектор ChatGPT для защищённого MCP требует совместимой авторизации. У ohmy-seo сейчас персональный Bearer-ключ, а OAuth-входа для MCP-клиентов нет.',
    steps: ['Для работы с ohmy-seo через OpenAI используйте локальный Codex — инструкция находится в соседней вкладке.', 'Добавление одного URL в веб-коннектор ChatGPT не передаёт наш API-ключ. Выбор «без авторизации» также не откроет доступ.', 'Инструкция для прямого веб-подключения появится после реализации и проверки совместимой авторизации на стороне ohmy-seo.'],
    note: 'Вход через Яндекс в кабинет и подключение рекламных аккаунтов — отдельные процессы. Они не заменяют OAuth-авторизацию между ChatGPT и MCP-сервером. Не добавляйте ключ в адрес сервера.',
    check: 'После настройки Codex запросите список аккаунтов. Прямое подключение ChatGPT Web пока не поддерживается.',
    sources: [{ label: 'Авторизация MCP для ChatGPT', url: 'https://developers.openai.com/apps-sdk/build/auth' }, { label: 'Подключение в ChatGPT', url: 'https://developers.openai.com/apps-sdk/deploy/connect-chatgpt' }],
  },
  {
    id: 'claude-web', name: 'Claude Web / Cowork', mode: 'Используйте локальный Claude Desktop',
    intro: 'Веб-коннекторы Claude и локальные MCP Claude Desktop — разные способы подключения. Готовая инструкция ohmy-seo с API-ключом сейчас рассчитана на локальный Desktop или Claude Code.',
    steps: ['Для подключения сейчас выберите Claude Desktop или Claude Code и выполните соответствующую инструкцию.', 'Не вставляйте JSON локального сервера в форму веб-коннектора. Она не запускает mcp-remote на вашем компьютере.', 'Прямое подключение по URL требует отдельной совместимой авторизации; этот сценарий ohmy-seo пока не предоставляет.'],
    check: 'Локальная настройка Desktop не переносит инструменты в claude.ai или Cowork. Проверяйте их в обычном чате Desktop.',
    sources: [{ label: 'Веб-коннекторы Claude', url: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp' }],
  },
  {
    id: 'other', name: 'Другой клиент', mode: 'Проверьте транспорт и авторизацию',
    intro: 'MCP — общий протокол. Другой AI-клиент или система автоматизации подойдёт, если умеет подключаться по Streamable HTTP и передавать заголовок авторизации.',
    steps: ['Добавьте удалённый MCP-сервер с адресом ниже. Выберите транспорт Streamable HTTP.', 'В настройках заголовков задайте Authorization со значением Bearer и вашим API-ключом через пробел. В отдельном поле Bearer Token обычно нужен только ключ.', 'Если доступны только локальные stdio-процессы, проверьте возможность запуска моста mcp-remote по примеру Claude Desktop.', 'Если клиент поддерживает только OAuth или старый SSE, прямой шаблон ohmy-seo к нему не подходит.'],
    config: 'URL: https://mcp.ohmy-seo.ru/mcp\nTransport: Streamable HTTP\nAuthorization: Bearer YOUR_API_KEY', configLabel: 'Параметры соединения — не JSON',
    check: 'Сначала получите список инструментов, затем вызовите list_accounts или list_google_accounts. Для автоматизаций отдельно настройте одобрение операций записи.',
    sources: [{ label: 'Исходный код и документация ohmy-seo', url: 'https://github.com/VKirill/ohmy-seo' }],
  },
];
