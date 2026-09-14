import { clientGuides } from '@/lib/marketing/clients';
import { CopyText } from './Interactive';

/** Native links keep client selection usable even before JavaScript loads. */
export function ClientInstructions({ activeId }: { activeId: string }) {
  return <div className="client-instructions">
    <nav className="client-tabs" aria-label="Выберите приложение для подключения MCP">
      {clientGuides.map(client => <a key={client.id} href={`/claude-mcp?client=${client.id}#clients`} aria-current={client.id === activeId ? 'page' : undefined}>{client.name}</a>)}
    </nav>
    {clientGuides.map(client => <section className="client-panel" key={client.id} hidden={client.id !== activeId} aria-labelledby={`client-${client.id}`}>
      <div className="client-heading"><h3 id={`client-${client.id}`}>{client.name}</h3><span>{client.mode}</span></div>
      <p>{client.intro}</p>
      <ol className="client-steps">{client.steps.map(step => <li key={step}>{step}</li>)}</ol>
      {client.config && <div className="client-config"><div className="client-config-top"><span>{client.configLabel}</span><CopyText key={client.id} text={client.config} label="Скопировать шаблон" /></div><pre><code>{client.config}</code></pre></div>}
      {client.note && <p className="client-note">{client.note}</p>}
      <div className="client-check"><strong>Проверка подключения</strong><p>{client.check}</p></div>
      <div className="client-sources">{client.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.label} ↗</a>)}</div>
    </section>)}
  </div>;
}
