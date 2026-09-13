import { currentUser } from "@/lib/session";
import { ProviderMark } from "@/components/ProviderMark";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  return (
    <main className="wrap">
      <h1>Один вход — и агент работает с вашей рекламой и аналитикой</h1>
      <p className="lead">
        Вы авторизуетесь Яндексом или Google. Мы не просим создавать приложение, выпускать
        OAuth-ключи и копировать токены — доступ к Директу, Метрике, Вебмастеру, Search Console,
        Analytics&nbsp;4 и Tag Manager появляется в вашем MCP сразу после входа.
      </p>

      <div className="row" style={{ marginBottom: 32 }}>
        {user ? (
          <a className="btn primary" href="/app">Перейти в кабинет</a>
        ) : (
          <>
            <a className="btn primary" href="/api/oauth/yandex/start?chain=1">
              <ProviderMark family="yandex" />
              <span>Войти через Яндекс</span>
            </a>
            <a className="btn" href="/api/oauth/google/start">
              <ProviderMark family="google" />
              <span>Войти через Google</span>
            </a>
          </>
        )}
      </div>

      <h2>Как это работает</h2>
      <div className="card">
        <strong>1. Вход = подключение аккаунта.</strong>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Одна кнопка — и аккаунт подключён целиком: у Яндекса это Директ, Метрика и Вебмастер,
          у Google — Search Console, Analytics 4 и Tag Manager. Второй и третий кабинет
          добавляются той же кнопкой.
        </p>
      </div>
      <div className="card">
        <strong>2. Выпускаете один API-ключ.</strong>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Ключ выдаётся на пользователя, а не на аккаунт. Все подключённые кабинеты приезжают
          в MCP по одному ключу, и новый аккаунт подхватывается без перенастройки клиента.
        </p>
      </div>
      <div className="card">
        <strong>3. Подключаете MCP — облачный или локальный.</strong>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Облачный режим — это один URL в конфиге клиента, ставить ничего не нужно. Локальный
          режим держит инструменты на вашей машине и ходит к нам только за свежими токенами.
        </p>
      </div>

      <h2>Что открывается</h2>
      <div className="card">
        <div style={{ marginBottom: 10 }}>
          <strong>Яндекс.</strong>{" "}
          <span className="tag">Директ (ЕПК)</span>
          <span className="tag">Метрика</span>
          <span className="tag">Вебмастер</span>
        </div>
        <div>
          <strong>Google.</strong>{" "}
          <span className="tag">Search Console</span>
          <span className="tag">Analytics 4</span>
          <span className="tag">Tag Manager</span>
        </div>
      </div>

      <div className="notice">
        Запись в рекламные кабинеты по умолчанию выключена. Изменяющие операции требуют явного
        подтверждения на каждый вызов, а удаление и остановка кампаний — отдельной строки-подтверждения.
      </div>
    </main>
  );
}
