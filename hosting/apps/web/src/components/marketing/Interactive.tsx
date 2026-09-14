'use client';

import { useState } from 'react';

export function CopyText({ text, label = 'Скопировать запрос' }: { text: string; label?: string }) {
  const [status, setStatus] = useState('');
  return <div className="copy-control"><button type="button" className="mk-copy" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setStatus('Скопировано'); }
    catch { setStatus('Не удалось скопировать. Выделите текст вручную.'); }
  }}>{label} <span aria-hidden="true">↗</span></button><span role="status">{status}</span></div>;
}

const scenarios = [
  { label: 'SEO', question: 'Какие страницы потеряли переходы из Google?', source: 'Search Console · сравнение двух периодов', steps: ['Получить клики, показы и CTR по страницам', 'Сравнить периоды и устройства', 'Выделить изменения и гипотезы'], columns: ['Страница', 'Клики', 'Изменение'], rows: [['/services', '840', '−18%'], ['/blog/guide', '620', '−12%'], ['/pricing', '310', '+8%']], finding: 'У /services снизились показы. Следующий шаг — проверить запросы и динамику позиций.', href: '/integrations/google-search-console' },
  { label: 'Реклама', question: 'Где выросла стоимость заявки в Директе?', source: 'Яндекс Директ · одна цель и модель атрибуции', steps: ['Получить расходы и конверсии', 'Сравнить CPL по кампаниям', 'Подготовить список проверок'], columns: ['Кампания', 'CPL', 'Изменение'], rows: [['Поиск · услуги', '1 240 ₽', '+16%'], ['Поиск · бренд', '380 ₽', '−8%'], ['РСЯ · интересы', '960 ₽', '+5%']], finding: 'В поисковой кампании CPL вырос. Проверьте поисковые запросы и настройки цели до изменения ставок.', href: '/integrations/yandex-direct' },
  { label: 'Аналитика', question: 'Какие каналы приводят к целевому действию?', source: 'GA4 · выбранное событие и период', steps: ['Уточнить метрики и событие', 'Получить отчёт по каналам', 'Сравнить объём и конверсию'], columns: ['Канал', 'События', 'Изменение'], rows: [['Organic Search', '126', '+14%'], ['Paid Search', '84', '−6%'], ['Direct', '42', '+5%']], finding: 'Органический поиск дал больше целевых событий. Разберите посадочные страницы, чтобы уточнить вклад.', href: '/integrations/google-analytics' },
];

export function ScenarioDemo() {
  const [active, setActive] = useState(0);
  const item = scenarios[active];
  return <div className="demo-shell">
    <div className="demo-toolbar"><span><i /> Рабочий диалог с AI</span><span className="demo-label">Учебный пример</span></div>
    <div className="demo-tabs" aria-label="Выберите пример задачи">{scenarios.map((s, i) => <button key={s.label} type="button" aria-pressed={i === active} onClick={() => setActive(i)}>{s.label}</button>)}</div>
    <div className="demo-content" aria-live="polite"><div className="demo-question"><span>Вы</span><p>{item.question}</p></div>
      <div className="demo-answer"><span className="demo-avatar" aria-hidden="true">✳</span><div><strong>Данные → сравнение → выводы</strong><ol>{item.steps.map(s => <li key={s}>{s}</li>)}</ol></div></div>
      <div className="demo-table"><table><caption>{item.source}</caption><thead><tr>{item.columns.map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{item.rows.map(r => <tr key={r[0]}>{r.map((c, i) => <td key={c} className={i === 2 ? 'delta' : undefined}>{c}</td>)}</tr>)}</tbody></table></div>
      <p className="demo-finding">{item.finding}</p><a className="text-link" href={item.href}>Как работает интеграция <span aria-hidden="true">↗</span></a>
    </div><div className="demo-foot">Вымышленные данные для иллюстрации. Реальный ответ зависит от данных и AI-клиента.</div>
  </div>;
}
