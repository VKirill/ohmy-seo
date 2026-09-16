import { MarketingShell } from "@/components/marketing/Shell";

export const metadata = {
  title: "Политика конфиденциальности — OhMySEO",
  description: "Политика конфиденциальности и правила обработки пользовательских данных платформы OhMySEO, включая данные Google API.",
};

export default function Privacy() {
  return (
    <MarketingShell>
      <main id="main-content" className="mk-container legal-page">
        <nav className="breadcrumbs" aria-label="Хлебные крошки">
          <a href="/">Главная</a>
          <span>/</span>
          <span>Приватность</span>
        </nav>
        <span className="eyebrow">OHMY-SEO · ОБРАБОТКА ДАННЫХ И БЕЗОПАСНОСТЬ</span>
        <h1>Политика конфиденциальности</h1>
        <p className="lead">
          Настоящий документ определяет порядок сбора, использования, защиты и удаления данных пользователей
          сервиса <strong>OhMySEO (https://ohmy-seo.ru)</strong>, а также содержит обязательные положения
          о соблюдении требований <em>Google API Services User Data Policy</em>.
        </p>

        <h2>1. Какие данные мы собираем и обрабатываем</h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            <strong>1.1. Данные авторизации в сервисе:</strong> при входе через Яндекс ID или создании аккаунта
            сохраняются системный идентификатор, адрес электронной почты и отображаемое имя пользователя.
          </p>
          <p>
            <strong>1.2. Данные пользователей Google (Google User Data):</strong> при добровольном подключении аккаунта
            Google через протокол OAuth 2.0 сервис OhMySEO запрашивает доступ к следующим типам данных исключительно
            в рамках предоставленных пользователем разрешений (Scopes):
          </p>
          <ul>
            <li>
              <strong>Данные профиля (Profile &amp; Identity):</strong> базовые сведения об учетной записи
              (Google User ID, email, отображаемое имя) для идентификации и привязки подключенного аккаунта к кабинету.
            </li>
            <li>
              <strong>Google Search Console (<code>https://www.googleapis.com/auth/webmasters</code>):</strong> список
              подтвержденных сайтов пользователя, поисковая статистика (поисковые запросы, показы, клики, позиции, CTR),
              статус проверки URL (URL Inspection API) и параметры файлов sitemap.xml.
            </li>
            <li>
              <strong>Google Analytics 4 (<code>https://www.googleapis.com/auth/analytics.readonly</code>,{" "}
              <code>https://www.googleapis.com/auth/analytics.edit</code>):</strong> список ресурсов (properties), потоков данных
              (data streams), отчеты по сессиям, источникам трафика, событиям и конверсиям, а также параметры аналитических конфигураций.
            </li>
            <li>
              <strong>Google Tag Manager (<code>https://www.googleapis.com/auth/tagmanager.readonly</code>,{" "}
              <code>https://www.googleapis.com/auth/tagmanager.edit.containers</code>,{" "}
              <code>https://www.googleapis.com/auth/tagmanager.publish</code>):</strong> метаданные учетных записей GTM, списки и настройки
              контейнеров, тегов, триггеров, пользовательских переменных и версий контейнеров.
            </li>
            <li>
              <strong>Токены авторизации (OAuth Credentials):</strong> краткосрочные токены доступа (access tokens) и токены
              обновления (refresh tokens), необходимые для выполнения автоматизированных запросов к API Google от имени пользователя.
            </li>
          </ul>
          <p style={{ marginBottom: 0 }}>
            <strong>1.3. Данные сервисов Яндекса:</strong> при подключении сервисов Яндекса обрабатываются аналогичные рабочие данные
            Яндекс Метрики, Вебмастера, Директа, Аудиторий и соответствующие OAuth-токены.
          </p>
        </div>

        <h2>2. Передача, раскрытие и обмен данными (Sharing, Transfer &amp; Disclosure)</h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            <strong>2.1. Полный запрет передачи третьим лицам:</strong> сервис OhMySEO{" "}
            <strong>не передает, не продает, не сдает в аренду и не раскрывает данные пользователей Google</strong>{" "}
            третьим лицам, рекламным сетям, аналитическим агрегаторам или брокерам данных.
          </p>
          <p>
            <strong>2.2. Запрет на использование для обучения AI-моделей:</strong> данные пользователей Google, полученные через
            Google APIs, <strong>ни при каких обстоятельствах не используются для обучения, дообучения или улучшения обобщенных
            моделей искусственного интеллекта и машинного обучения (AI/ML models)</strong>.
          </p>
          <p>
            <strong>2.3. Целевое назначение обработки:</strong> данные пользователей Google обрабатываются исключительно серверами
            OhMySEO и только для предоставления запрошенных пользователем функций — формирования SEO-отчетов, мониторинга поисковой
            видимости, агрегации веб-аналитики и управления разметкой через интерфейс или авторизованные пользователем MCP-инструменты.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>2.4. Google API Services User Data Policy:</strong> Использование сервисом OhMySEO информации, полученной из API
            Google, и ее передача в любые другие приложения строго соответствуют{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , включая требования ограниченного использования (<strong>Limited Use requirements</strong>).
          </p>
        </div>

        <h2>3. Механизмы защиты и безопасности данных (Data Protection Mechanisms)</h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            Для защиты конфиденциальных данных и токенов пользователей OhMySEO применяет многоуровневый комплекс
            технических и организационных мер информационной безопасности:
          </p>
          <ul>
            <li>
              <strong>Шифрование данных при передаче (Encryption in Transit):</strong> все сетевые коммуникации между браузером
              пользователя, нашими серверами и конечными точками Google APIs осуществляются исключительно по защищенным протоколам{" "}
              <strong>HTTPS / TLS 1.3</strong> с принудительной политикой HSTS (Strict-Transport-Security). Нешифрованный трафик полностью заблокирован.
            </li>
            <li>
              <strong>Шифрование данных при хранении (Encryption at Rest):</strong> все учетные данные OAuth, access-токены и refresh-токены
              шифруются в базе данных на уровне строк с применением криптографического алгоритма военного стандарта{" "}
              <strong>AES-256-GCM (Galois/Counter Mode)</strong>, обеспечивающего аутентифицированное шифрование и защиту от подмены данных.
            </li>
            <li>
              <strong>Изоляция мастер-ключей (Key Management &amp; Isolation):</strong> ключи шифрования хранятся строго изолированно
              от базы данных в выделенном хранилище секрета хоста (<code>/run/secrets/ohmy_master</code>) с правами доступа <code>0400</code>,
              монтируются через Docker Secrets и никогда не сохраняются в файлах исходного кода или репозиториях.
            </li>
            <li>
              <strong>Изоляция инфраструктуры (Container Hardening):</strong> веб-сервер и API-шлюз выполняются в изолированных контейнерах
              Docker под непривилегированным пользователем (UID 1001), в режиме неизменяемой файловой системы (<code>read_only: true</code>),
              с полным сбросом привилегий ядра Linux (<code>cap_drop: ALL</code>), флагом <code>no-new-privileges: true</code> и жесткими
              лимитами на память и количество процессов (PIDs).
            </li>
            <li>
              <strong>Строгий контроль доступа и аудит:</strong> доступ к токенам имеют только авторизованные фоновые процессы сервиса,
              обслуживающие подтвержденный API-ключ владельца. Каждая операция использования и обновления токена фиксируется в неизменяемом
              журнале аудита (<code>audit_log</code>). Сотрудники сервиса не имеют доступа к токенам или пользовательским учетным записям.
            </li>
          </ul>
        </div>

        <h2>4. Хранение, отзыв доступа и удаление данных (Retention &amp; Deletion)</h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            <strong>4.1. Срок хранения:</strong> токены доступа и обновления хранятся только до тех пор, пока аккаунт остается подключенным
            к сервису OhMySEO.
          </p>
          <p>
            <strong>4.2. Отключение в кабинете:</strong> пользователь может в любой момент в один клик отключить аккаунт Google в личном
            кабинете (кнопка «Отключить» напротив аккаунта) — все связанные токены доступа и обновления немедленно и безвозвратно удаляются
            из базы данных сервиса.
          </p>
          <p>
            <strong>4.3. Отзыв разрешений в Google:</strong> пользователь может в любое время отозвать доступ приложения OhMySEO на стороне Google
            в официальном центре безопасности:{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              Управление сторонними приложениями с доступом к аккаунту Google
            </a>
            .
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>4.4. Полное удаление учетной записи:</strong> для удаления аккаунта OhMySEO и всех связанных данных направьте запрос
            на адрес <a href="mailto:support@ohmy-seo.ru">support@ohmy-seo.ru</a>. Запрос обрабатывается в течение 30 календарных дней,
            после чего все профили и журналы необратимо стираются.
          </p>
        </div>

        <h2>5. Google API Services User Data Policy &amp; Limited Use Disclosure (English)</h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            <em>
              This section is provided in English to explicitly state compliance with Google&apos;s API Services User Data Policy
              for Google Trust &amp; Safety reviewers.
            </em>
          </p>
          <p>
            <strong>Google API Compliance Statement:</strong>
            <br />
            <strong>
              OhMySEO&apos;s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </strong>
          </p>
          <p>
            <strong>1. What Google user data is accessed:</strong>
            <br />
            OhMySEO requests and accesses Google user data strictly necessary to deliver authorized SEO reporting, performance analytics,
            and tag automation features:
          </p>
          <ul>
            <li>
              <strong>Google Account Profile:</strong> Google User ID, email address, and display name for account identification
              and multi-account connection management.
            </li>
            <li>
              <strong>Google Search Console (<code>webmasters</code>):</strong> Verified site URLs, search performance metrics
              (queries, impressions, clicks, click-through rates, positions), URL inspection statuses, and sitemap submissions.
            </li>
            <li>
              <strong>Google Analytics 4 (<code>analytics.readonly</code>, <code>analytics.edit</code>):</strong> Analytics property
              and data stream metadata, aggregated traffic, session, conversion, and event metrics, as well as data stream configuration.
            </li>
            <li>
              <strong>Google Tag Manager (<code>tagmanager.readonly</code>, <code>tagmanager.edit.containers</code>,{" "}
              <code>tagmanager.publish</code>):</strong> Account and container metadata, tags, triggers, custom variables, and container
              version releases.
            </li>
            <li>
              <strong>OAuth 2.0 Credentials:</strong> Time-limited access tokens and encrypted refresh tokens required to interact
              with Google APIs on behalf of the user.
            </li>
          </ul>
          <p>
            <strong>2. How Google user data is shared, transferred, or disclosed:</strong>
            <br />
            <strong>We DO NOT share, transfer, sell, rent, or disclose Google user data to any third parties</strong>, advertising
            networks, data brokers, or external analytics vendors. We <strong>DO NOT use Google user data to train, fine-tune,
            or improve generalized artificial intelligence or machine learning (AI/ML) models</strong>. All Google user data is
            transmitted solely between Google API servers and OhMySEO&apos;s backend to perform user-requested actions.
          </p>
          <p>
            <strong>3. Data Protection and Security Mechanisms:</strong>
            <br />
            All data in transit is encrypted using <strong>HTTPS with TLS 1.3 / TLS 1.2</strong> and forced HSTS. All sensitive OAuth
            tokens at rest are encrypted using authenticated <strong>AES-256-GCM</strong> encryption. The encryption master key is
            isolated from the database using secure host secret stores (<code>/run/secrets/</code>). Server environments enforce
            least-privilege containerization (unprivileged execution, read-only root filesystems, dropped capabilities, and strict PID/memory limits).
            Every token access is logged in an internal tamper-resistant audit log.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>4. User Control and Data Revocation:</strong>
            <br />
            Users can revoke access at any time directly through the OhMySEO dashboard (one-click disconnect which permanently deletes all stored tokens)
            or through{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              Google Account Permissions
            </a>
            . Full account and data deletion can be requested at <a href="mailto:support@ohmy-seo.ru">support@ohmy-seo.ru</a>.
          </p>
        </div>

        <h2>6. Контактная информация оператора</h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            <strong>Оператор обработки персональных данных:</strong> Вечкасов Кирилл
          </p>
          <p>
            <strong>Веб-сайт сервиса:</strong> <a href="https://ohmy-seo.ru">https://ohmy-seo.ru</a>
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Служба технической поддержки и вопросы приватности:</strong>{" "}
            <a href="mailto:support@ohmy-seo.ru">support@ohmy-seo.ru</a>
          </p>
        </div>
      </main>
    </MarketingShell>
  );
}
