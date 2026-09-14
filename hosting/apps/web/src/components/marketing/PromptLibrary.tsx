import { promptCategories } from '@/lib/marketing/prompts';
import { CopyText } from './Interactive';
import { ServiceLogo } from './ServiceLogo';

/** Native links keep service selection usable before or without client hydration. */
export function PromptLibrary({ activeSlug }: { activeSlug: string }) {
  return <div className="prompt-library" id="questions">
    <nav className="prompt-tabs" aria-label="Направления работы">
      {promptCategories.map(category => <a key={category.slug} href={`/prompts?service=${category.slug}#questions`} aria-current={activeSlug === category.slug ? 'page' : undefined}>{category.name === 'Google Ads' ? 'Google Реклама' : category.name}<span aria-label={`Вопросов: ${category.prompts.length}`}>{category.prompts.length}</span></a>)}
    </nav>
    {promptCategories.map(category => <section key={category.slug} id={`panel-${category.slug}`} aria-labelledby={`heading-${category.slug}`} hidden={activeSlug !== category.slug}>
      <div className="prompt-category-heading"><div className="prompt-service"><ServiceLogo slug={category.slug} /><div><span className="eyebrow">{category.category} · {category.mode}</span><h2 id={`heading-${category.slug}`}>{category.name}</h2></div></div><a href={`/integrations/${category.slug}`}>Возможности и подключение ↗</a></div>
      <div className="prompt-library-grid">{category.prompts.map((prompt, i) => <article className="prompt-card" key={prompt.title}><span className="eyebrow">ВОПРОС {String(i + 1).padStart(2, '0')}</span><h3>{prompt.title}</h3><p>{prompt.text}</p><CopyText text={prompt.text} /></article>)}</div>
    </section>)}
  </div>;
}
