import type { Metadata } from "next";
import { socialMetadata, siteGraph } from "@/lib/marketing/seo";
import { JsonLd } from "@/components/marketing/JsonLd";
import "./globals.css";
import "./marketing.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ohmy-seo.ru"),
  title: "ohmy-seo — бесплатный MCP для маркетологов",
  description:
    "Бесплатный инструмент специально для маркетологов: работа с рекламой, SEO и аналитикой через AI-ассистента.",
  ...socialMetadata("ohmy-seo — бесплатный MCP для маркетологов", "Реклама, SEO и аналитика через AI-ассистента."),
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
        <JsonLd data={siteGraph} />
      </body>
    </html>
  );
}
