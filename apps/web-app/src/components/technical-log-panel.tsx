import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface LogEntry {
  id: string;
  time: string;
  level: "info" | "warn" | "error";
  message: string;
  requestId?: string | null;
  details?: string;
}

interface TechnicalLogPanelProps {
  logs: LogEntry[];
  onClear: () => void;
}

export function TechnicalLogPanel({ logs, onClear }: TechnicalLogPanelProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">Teknisk logg</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Tøm logg
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-40 rounded-md border border-earth-500/25 bg-paper/70 p-2">
          {logs.length === 0 ? (
            <p className="px-2 py-1 text-xs text-earth-700">Ingen logger enda.</p>
          ) : (
            <ul className="space-y-1 px-1 py-1 text-xs">
              {logs.map((entry) => (
                <li key={entry.id} className="rounded border border-earth-500/20 bg-paper px-2 py-1">
                  <p className="font-mono text-[11px] text-earth-800">
                    {entry.time} [{entry.level}] {entry.message}
                  </p>
                  {entry.requestId ? <p className="font-mono text-[10px] text-earth-600">req: {entry.requestId}</p> : null}
                  {entry.details ? <p className="font-mono text-[10px] text-earth-600">{entry.details}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
