import { MarketingShell } from "@/components/marketing/Shell";

export const metadata = {
  title: "Privacy Policy / Политика конфиденциальности — OhMySEO",
  description:
    "What Google and Yandex user data OhMySEO accesses, who it is shared with, how it is protected and how to delete it.",
};

const USER_DATA_POLICY = "https://developers.google.com/terms/api-services-user-data-policy";
const GOOGLE_PERMISSIONS = "https://myaccount.google.com/permissions";

export default function Privacy() {
  return (
    <MarketingShell>
      <main id="main-content" className="mk-container legal-page">
        <nav className="breadcrumbs" aria-label="Breadcrumbs">
          <a href="/">Главная</a>
          <span>/</span>
          <span>Privacy</span>
        </nav>
        <span className="eyebrow">OHMY-SEO · PRIVACY POLICY</span>
        <h1>Privacy Policy</h1>
        <p className="lead">
          Effective September 17, 2026. This policy explains what data OhMySEO (<a href="https://ohmy-seo.ru">ohmy-seo.ru</a>)
          accesses, including data received from Google APIs, how it is used, who it is shared with, how it is protected and
          how you can delete it. Русская версия — <a href="#ru">ниже</a>.
        </p>

        <section lang="en">
          <h2>1. Google user data we access</h2>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              You can connect one or more Google accounts in your OhMySEO dashboard. Access is granted only through Google
              OAuth 2.0 and only for the scopes you approve on Google&apos;s consent screen. We access:
            </p>
            <ul>
              <li>
                <strong>Basic profile</strong> (<code>openid</code>, <code>email</code>, <code>profile</code>): your Google
                account ID, email address and name. Used to identify the connected account in your dashboard.
              </li>
              <li>
                <strong>Google Search Console</strong> (<code>webmasters</code>): the list of your verified sites, search
                performance data (queries, pages, clicks, impressions, CTR, average position), URL Inspection results and
                sitemaps. Write access is used only to submit or delete a sitemap when you explicitly confirm that action.
              </li>
              <li>
                <strong>Google Analytics</strong> (<code>analytics.readonly</code>, <code>analytics.edit</code>): the list of
                accounts and properties, property metadata, custom dimensions, conversion events and reports you request
                (sessions, traffic sources, events, conversions, realtime data).
              </li>
              <li>
                <strong>Google Tag Manager</strong> (<code>tagmanager.readonly</code>, <code>tagmanager.edit.containers</code>,{" "}
                <code>tagmanager.publish</code>): accounts, containers, workspaces, tags, triggers, variables and versions.
                Write access is used only to create or change tags, triggers, variables and versions, publish a version or
                roll back, and only when you explicitly confirm that action.
              </li>
              <li>
                <strong>OAuth tokens</strong>: the access token and refresh token Google issues for the connection.
              </li>
            </ul>
            <p style={{ marginBottom: 0 }}>
              We do not access Gmail, Google Drive, Contacts, Calendar or any other Google service. When you sign in to
              OhMySEO itself (via Yandex ID) we store your account ID, email address and display name.
            </p>
          </div>

          <h2>2. How we use Google user data</h2>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              Google user data is used only to provide the features you request: showing your connected accounts and
              answering SEO and analytics requests that you, or an AI assistant you have connected with your personal API key,
              send to OhMySEO through the Model Context Protocol (MCP).
            </p>
            <p>We do not:</p>
            <ul>
              <li>sell Google user data or transfer it to data brokers or information resellers;</li>
              <li>use it to serve advertising, including retargeting or personalized ads;</li>
              <li>use it to develop, train or improve generalized AI or machine learning models;</li>
              <li>use it to determine creditworthiness or for lending purposes.</li>
            </ul>
            <p style={{ marginBottom: 0 }}>
              No person reads Google user data unless you give explicit consent (for example, in a support request), it is
              necessary for security purposes such as investigating abuse, or it is required by law.
            </p>
          </div>

          <h2>3. Who we share Google user data with</h2>
          <div className="card">
            <p style={{ marginTop: 0 }}>Google user data is shared, transferred or disclosed only in these cases:</p>
            <ul>
              <li>
                <strong>The AI assistant or MCP client you connect.</strong> When you connect an AI assistant (for example
                Claude, ChatGPT or Cursor) using your OhMySEO API key, the results of the requests it makes on your behalf,
                such as a Search Console report, are returned to that assistant. This happens only at your direction. The
                assistant&apos;s provider processes that data under its own terms and privacy policy. You can stop this at any
                time by revoking the API key or disconnecting the Google account.
              </li>
              <li>
                <strong>Your own device</strong>, only if you explicitly enable local token sync for a specific API key. In
                that case short-lived access tokens are sent to the sync client on your computer. Refresh tokens never leave
                our servers.
              </li>
              <li>
                <strong>Our hosting provider</strong>, OVHcloud (data centers in the European Union), which hosts our servers and stores data
                on our behalf as infrastructure only and has no right to use it.
              </li>
              <li>
                <strong>Legal requirements</strong>: when required by applicable law or a valid legal request, or to protect
                the security of the service and its users.
              </li>
              <li>
                <strong>Business transfer</strong>: as part of a merger, acquisition or sale of the service, with prior notice
                to you, under the same protections described here.
              </li>
            </ul>
            <p style={{ marginBottom: 0 }}>
              We do not share Google user data with advertisers, analytics vendors or any other third party.
            </p>
          </div>

          <h2>4. How we protect sensitive data</h2>
          <div className="card">
            <ul style={{ marginTop: 0 }}>
              <li>
                <strong>Encryption in transit:</strong> all traffic to OhMySEO and to Google APIs uses HTTPS (TLS 1.2 or
                higher). Plain HTTP requests are redirected to HTTPS, and HSTS is enabled.
              </li>
              <li>
                <strong>Encryption at rest:</strong> OAuth access and refresh tokens are encrypted with AES-256-GCM before
                they are written to the database or the token cache. Tokens copied into a user&apos;s isolated workspace are
                encrypted again with a separate per-user key.
              </li>
              <li>
                <strong>Key isolation:</strong> the master encryption key is stored outside the database and source code, in
                a file readable only by the service process, and is mounted into containers as a Docker secret.
              </li>
              <li>
                <strong>Least privilege:</strong> refresh tokens stay in the central database; the processes that call
                Google APIs receive only short-lived access tokens. Each user&apos;s processes can read and write only that
                user&apos;s directory. Services run in containers as a non-root user with a read-only file system, all Linux
                capabilities dropped, privilege escalation disabled and memory and process limits.
              </li>
              <li>
                <strong>Access control:</strong> API keys are stored only as SHA-256 hashes. Every request is authorized
                against the key owner, and a user can never read another user&apos;s connections. Database and cache are not
                exposed to the internet. Server administration is limited to the operator.
              </li>
              <li>
                <strong>Write safety:</strong> changes to your Google accounts are never made without an explicit
                confirmation for that specific operation.
              </li>
              <li>
                <strong>Audit and logging:</strong> token issuance, refresh and revocation are recorded in an audit log.
                Google API responses and tokens are not written to application logs.
              </li>
            </ul>
          </div>

          <h2>5. Retention and deletion</h2>
          <div className="card">
            <ul style={{ marginTop: 0 }}>
              <li>
                <strong>Tokens</strong> are kept only while the Google account stays connected.
              </li>
              <li>
                <strong>Cached API responses</strong> are kept for at most 24 hours, and are deleted after 15 minutes of
                inactivity or when you disconnect an account.
              </li>
              <li>
                <strong>Disconnect:</strong> clicking &quot;Disconnect&quot; in the dashboard revokes the grant with Google and
                erases the stored access and refresh tokens immediately.
              </li>
              <li>
                <strong>Revoke in Google:</strong> you can also remove OhMySEO&apos;s access at any time in your{" "}
                <a href={GOOGLE_PERMISSIONS} target="_blank" rel="noreferrer">
                  Google Account permissions
                </a>
                .
              </li>
              <li>
                <strong>Account deletion:</strong> email <a href="mailto:support@ohmy-seo.ru">support@ohmy-seo.ru</a> from the
                address linked to your account. Within 30 days we delete your account, connections, API keys, audit records
                and cached data.
              </li>
            </ul>
          </div>

          <h2>6. Compliance with the Google API Services User Data Policy</h2>
          <div className="card">
            <p style={{ margin: 0 }}>
              <strong>
                OhMySEO&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
                <a href={USER_DATA_POLICY} target="_blank" rel="noreferrer">
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </strong>
            </p>
          </div>

          <h2>7. Changes and contact</h2>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              We will post any changes to this policy on this page and update the effective date. If a change expands how
              Google user data is used, we will ask for your consent first.
            </p>
            <p style={{ marginBottom: 0 }}>
              Data controller: Kirill Vechkasov. Contact for privacy questions and deletion requests:{" "}
              <a href="mailto:support@ohmy-seo.ru">support@ohmy-seo.ru</a>.
            </p>
          </div>
        </section>

        <section lang="ru" id="ru">
          <h1>Политика конфиденциальности</h1>
          <p className="lead">
            Действует с 17 сентября 2026 года. Здесь описано, какие данные обрабатывает сервис OhMySEO, включая данные
            из API Google, зачем они нужны, кому передаются, как защищены и как их удалить.
          </p>

          <h2>1. Какие данные Google мы получаем</h2>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              Аккаунты Google подключаются в кабинете через OAuth 2.0 и только в пределах разрешений, которые вы
              подтвердили на экране согласия Google:
            </p>
            <ul>
              <li>
                <strong>Базовый профиль</strong> (<code>openid</code>, <code>email</code>, <code>profile</code>): ID аккаунта,
                адрес почты и имя. Нужны, чтобы показать подключённый аккаунт в кабинете.
              </li>
              <li>
                <strong>Google Search Console</strong> (<code>webmasters</code>): список подтверждённых сайтов, поисковая
                статистика (запросы, страницы, клики, показы, CTR, средняя позиция), результаты проверки URL и файлы Sitemap.
                Запись используется только для отправки или удаления Sitemap после вашего явного подтверждения.
              </li>
              <li>
                <strong>Google Analytics</strong> (<code>analytics.readonly</code>, <code>analytics.edit</code>): аккаунты и
                ресурсы, их метаданные, пользовательские параметры, конверсии и запрошенные вами отчёты.
              </li>
              <li>
                <strong>Google Tag Manager</strong> (<code>tagmanager.readonly</code>, <code>tagmanager.edit.containers</code>,{" "}
                <code>tagmanager.publish</code>): аккаунты, контейнеры, рабочие области, теги, триггеры, переменные и версии.
                Изменения и публикация выполняются только после вашего явного подтверждения.
              </li>
              <li>
                <strong>OAuth-токены</strong>: токен доступа и токен обновления для подключения.
              </li>
            </ul>
            <p style={{ marginBottom: 0 }}>
              Мы не получаем доступ к Gmail, Google Диску, контактам, календарю и другим сервисам Google. При входе в сам
              сервис через Яндекс ID сохраняются идентификатор, адрес почты и отображаемое имя. Для подключённых сервисов
              Яндекса (Метрика, Вебмастер, Директ, Аудитории) действуют те же правила использования, хранения и защиты.
            </p>
          </div>

          <h2>2. Как мы используем данные Google</h2>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              Только для функций, которые вы запрашиваете: показать подключённые аккаунты и выполнить SEO- и
              аналитические запросы, которые отправляете вы или ИИ-ассистент, подключённый по вашему API-ключу через MCP.
            </p>
            <p style={{ marginBottom: 0 }}>
              Мы не продаём данные, не передаём их брокерам данных, не используем для рекламы, для обучения или улучшения
              моделей ИИ и для оценки кредитоспособности. Люди не читают данные Google, кроме случаев, когда вы сами на это
              согласились (например, в обращении в поддержку), это нужно для безопасности или этого требует закон.
            </p>
          </div>

          <h2>3. Кому передаются данные Google</h2>
          <div className="card">
            <ul style={{ marginTop: 0 }}>
              <li>
                <strong>ИИ-ассистенту или MCP-клиенту, который вы подключили</strong> (например, Claude, ChatGPT, Cursor).
                Ему возвращаются результаты запросов, сделанных от вашего имени. Передача происходит только по вашей
                инициативе, дальше данные обрабатываются по правилам этого провайдера. Остановить передачу можно, отозвав
                API-ключ или отключив аккаунт Google.
              </li>
              <li>
                <strong>На ваше устройство</strong>, только если вы включили локальную синхронизацию для конкретного
                API-ключа. Передаются короткоживущие токены доступа; токены обновления не покидают наш сервер.
              </li>
              <li>
                <strong>Хостинг-провайдеру</strong> OVHcloud (дата-центры в Евросоюзе), который предоставляет серверы и хранит
                данные только как инфраструктура, без права их использовать.
              </li>
              <li>
                <strong>По требованию закона</strong> или для защиты безопасности сервиса и пользователей.
              </li>
              <li>
                <strong>При реорганизации или продаже сервиса</strong> — с предварительным уведомлением и на тех же условиях
                защиты.
              </li>
            </ul>
            <p style={{ marginBottom: 0 }}>Рекламодателям, аналитическим компаниям и другим третьим лицам данные не передаются.</p>
          </div>

          <h2>4. Как мы защищаем данные</h2>
          <div className="card">
            <ul style={{ marginTop: 0 }}>
              <li>Весь трафик идёт по HTTPS (TLS 1.2 и выше): HTTP-запросы перенаправляются на HTTPS, включён HSTS.</li>
              <li>
                Токены доступа и обновления шифруются AES-256-GCM до записи в базу и кеш; в изолированной рабочей папке
                пользователя токены дополнительно шифруются его отдельным ключом.
              </li>
              <li>
                Мастер-ключ хранится вне базы и исходного кода, в файле с доступом только для процесса сервиса, и
                подключается к контейнерам как Docker secret.
              </li>
              <li>
                Токены обновления остаются в центральной базе, процессы, обращающиеся к API Google, получают только
                короткоживущие токены доступа и видят только папку своего пользователя. Контейнеры работают от
                непривилегированного пользователя, с файловой системой только для чтения, без привилегий Linux и с лимитами
                памяти и процессов.
              </li>
              <li>
                API-ключи хранятся только в виде SHA-256-хешей; пользователь не может получить чужие подключения. База данных
                и кеш недоступны из интернета, администрирование серверов доступно только оператору.
              </li>
              <li>Изменения в аккаунтах Google выполняются только после явного подтверждения каждой операции.</li>
              <li>
                Выдача, обновление и отзыв токенов записываются в журнал аудита; ответы API Google и токены в логи
                приложения не пишутся.
              </li>
            </ul>
          </div>

          <h2>5. Сроки хранения и удаление</h2>
          <div className="card">
            <ul style={{ marginTop: 0 }}>
              <li>Токены хранятся, только пока аккаунт подключён.</li>
              <li>
                Кешированные ответы API хранятся не дольше 24 часов и удаляются через 15 минут бездействия или при отключении
                аккаунта.
              </li>
              <li>
                Кнопка «Отключить» в кабинете отзывает доступ на стороне Google и сразу стирает сохранённые токены.
              </li>
              <li>
                Отозвать доступ можно и в{" "}
                <a href={GOOGLE_PERMISSIONS} target="_blank" rel="noreferrer">
                  настройках аккаунта Google
                </a>
                .
              </li>
              <li>
                Для удаления учётной записи напишите на <a href="mailto:support@ohmy-seo.ru">support@ohmy-seo.ru</a> с адреса,
                привязанного к аккаунту. В течение 30 дней мы удаляем аккаунт, подключения, API-ключи, журнал аудита и
                кешированные данные.
              </li>
            </ul>
          </div>

          <h2>6. Соответствие правилам Google</h2>
          <div className="card">
            <p style={{ margin: 0 }}>
              Использование и передача в другие приложения информации, полученной из API Google, соответствуют{" "}
              <a href={USER_DATA_POLICY} target="_blank" rel="noreferrer">
                Google API Services User Data Policy
              </a>
              , включая требования Limited Use.
            </p>
          </div>

          <h2>7. Изменения и контакты</h2>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              Изменения публикуются на этой странице с новой датой. Если изменение расширяет использование данных Google, мы
              сначала запросим ваше согласие.
            </p>
            <p style={{ marginBottom: 0 }}>
              Оператор данных — Вечкасов Кирилл. Вопросы и запросы на удаление:{" "}
              <a href="mailto:support@ohmy-seo.ru">support@ohmy-seo.ru</a>.
            </p>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
