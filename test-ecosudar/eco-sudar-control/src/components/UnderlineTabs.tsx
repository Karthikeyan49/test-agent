import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ReactNode } from 'react';

export interface TabItem {
  value: string;
  label: string;
}

interface UnderlineTabsProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: TabItem[];
  children?: ReactNode;
}

export function UnderlineTabs({ value, onValueChange, tabs, children }: UnderlineTabsProps) {
  return (
    <Tabs value={value} onValueChange={onValueChange}>
      <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0 h-auto mb-0">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-5 py-3 text-sm font-medium"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}

export default UnderlineTabs;
