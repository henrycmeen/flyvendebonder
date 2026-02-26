export interface TechnicalLogItem {
  id: string;
  main: string;
  requestId?: string | null;
  details?: string;
}

interface TechnicalLogListProps {
  items: TechnicalLogItem[];
  emptyText: string;
}

export function TechnicalLogList({ items, emptyText }: TechnicalLogListProps) {
  if (items.length === 0) {
    return <p className="px-2 py-1 text-xs text-fb-text-secondary">{emptyText}</p>;
  }

  return (
    <ul className="space-y-1 px-1 py-1 text-xs">
      {items.map((entry) => (
        <li key={entry.id} className="rounded border border-fb-border-subtle bg-fb-surface-ghost px-2 py-1">
          <p className="font-mono text-[11px] text-fb-text-primary">{entry.main}</p>
          {entry.requestId ? <p className="font-mono text-[10px] text-fb-text-secondary">req: {entry.requestId}</p> : null}
          {entry.details ? <p className="font-mono text-[10px] text-fb-text-secondary">{entry.details}</p> : null}
        </li>
      ))}
    </ul>
  );
}
