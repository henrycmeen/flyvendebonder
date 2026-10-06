import { Button } from "@/components/ui/button";

export function LibraryNavigation({ active, onChange }: {
  active: "album" | "orthophotos" | "comparison";
  onChange: (view: "album" | "orthophotos" | "comparison") => void;
}) {
  return (
    <nav aria-label="Bibliotekinnhold" className="flex gap-1 border-b border-fb-border-subtle pb-2">
      {([{ view: "album", label: "Bilder" }, { view: "orthophotos", label: "Ortofoto" }, { view: "comparison", label: "Sammenlign" }] as const).map(({ view, label }) => (
        <Button key={view} variant="ghost" aria-current={active === view ? "page" : undefined}
          className={active === view ? "rounded-lg bg-fb-surface-ghost text-fb-text-primary" : "rounded-lg text-fb-text-secondary"}
          onClick={() => onChange(view)}>{label}</Button>
      ))}
    </nav>
  );
}
