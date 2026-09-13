import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ohmy-seo — один вход во все SEO- и рекламные API",
  description:
    "Авторизуйтесь Яндексом или Google и получите готовый MCP-доступ к Директу, Метрике, Вебмастеру, Search Console, Analytics 4 и Tag Manager.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <header className="top">
          <div className="wrap">
            <a className="brand" href="/">oh<span>my</span>-seo</a>
            <nav style={{ display: "flex", gap: 18 }}>
              <a href="/app">Кабинет</a>
              <a href="/privacy">Приватность</a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
