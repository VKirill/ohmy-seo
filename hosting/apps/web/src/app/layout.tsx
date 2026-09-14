import type { Metadata } from "next";
import "./globals.css";
import "./marketing.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ohmy-seo.ru"),
  title: "ohmy-seo — бесплатный MCP для маркетологов",
  description:
    "Бесплатный инструмент специально для маркетологов: работа с рекламой, SEO и аналитикой через AI-ассистента.",
  openGraph: { type: "website", locale: "ru_RU", siteName: "ohmy-seo", images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "ohmy-seo — ваш маркетинг в диалоге с AI" }] },
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
