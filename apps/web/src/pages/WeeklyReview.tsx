import { Link } from 'react-router-dom';
import { useQuery } from '../lib/hooks';
import { useApp } from '../App';
import { dateLabel, money, pluralise, titleCase } from '../lib/format';
import { Icon } from '../components/Icon';
import { EmptyState, Panel, Spinner, StatTile } from '../components/ui';

/** The Sunday planning page (DASH-004). */
export function WeeklyReview() {
  const app = useApp();
  const { data, loading } = useQuery<any>('/dashboard/weekly-review');
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <header>
        <Link to="/" className="text-xs dim hover:underline">← Today</Link>
        <h1 className="text-xl font-semibold mt-0.5">The week just gone</h1>
        <p className="dim text-sm">{data.week.from} to {data.week.to}</p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Tasks done" value={data.completed.total} icon="check" tone="good"
                  sub={data.completed.minutes ? `${Math.round(data.completed.minutes / 6) / 10} hours logged` : undefined} />
        <StatTile label="Spent" value={money(data.spending.total, app.currency)} icon="coin"
                  sub={pluralise(data.spending.count, 'transaction')} />
        <StatTile label="Food wasted" value={money(data.waste.cost, app.currency)} icon="trash"
                  sub={pluralise(data.waste.count, 'item')} tone={data.waste.count ? 'warn' : 'default'} />
        <StatTile label="Things stored" value={data.newStorageItems} icon="box" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Panel title="What got done" dense>
          {!data.completed.items.length ? (
            <EmptyState icon="check" title="Nothing completed this week" />
          ) : (
            <>
              <div className="px-4 pt-3 flex flex-wrap gap-1.5">
                {data.completed.byOrigin.map((o: any) => (
                  <span key={o.origin} className="chip">{titleCase(o.origin)} · {o.count}</span>
                ))}
              </div>
              <ul className="mt-2">
                {data.completed.items.map((t: any) => (
                  <li key={t.id} className="flex items-center gap-2 px-4 py-1.5 border-b last:border-0 text-sm">
                    <Icon name="check" size={13} className="dim shrink-0" />
                    <span className="flex-1 truncate">{t.title}</span>
                    <span className="text-xs dim shrink-0">{dateLabel(t.completedAt?.slice(0, 10), app.today)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel title={`The week ahead (${data.ahead.total})`} dense>
          {!data.ahead.items.length ? (
            <EmptyState icon="calendar" title="Nothing scheduled" hint="A quiet week. Or a week to get ahead." />
          ) : (
            <ul>
              {data.ahead.items.map((t: any) => (
                <li key={t.id} className="flex items-center gap-2 px-4 py-1.5 border-b last:border-0 text-sm">
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="chip shrink-0">{dateLabel(t.dueDate, app.today)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
