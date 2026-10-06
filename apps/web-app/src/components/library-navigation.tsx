import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const libraryViews = [
  { view: "album", label: "Bilder" },
  { view: "orthophotos", label: "Ortofoto" },
  { view: "comparison", label: "Sammenlign" },
] as const;

type LibraryView = (typeof libraryViews)[number]["view"];

export function LibraryNavigation({ active, onChange, children }: {
  active: LibraryView;
  onChange: (view: LibraryView) => void;
  children: ReactNode;
}) {
  return (
    <Tabs
      value={active}
      activationMode="manual"
      onValueChange={(value) => {
        const selected = libraryViews.find(({ view }) => view === value);
        if (selected) onChange(selected.view);
      }}
    >
      <TabsList aria-label="Bibliotekinnhold" className="flex w-full sm:inline-flex sm:w-auto">
        {libraryViews.map(({ view, label }) => (
          <TabsTrigger key={view} value={view} className="min-w-0 flex-1 sm:flex-none transition-none data-[state=inactive]:hover:!bg-transparent">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={active}>
        {children}
      </TabsContent>
    </Tabs>
  );
}
