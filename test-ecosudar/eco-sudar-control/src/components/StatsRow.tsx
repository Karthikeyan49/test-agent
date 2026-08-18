import type { LucideIcon } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { cn } from '@/lib/utils';

export interface StatItem {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  subtitleColor?: 'primary' | 'muted';
}

interface StatsRowProps {
  stats: StatItem[];
  gridClass?: string;
}

export function StatsRow({
  stats,
  gridClass = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
}: StatsRowProps) {
  return (
    <div className={cn(gridClass)}>
      {stats.map((s) => (
        <StatCard
          key={s.title}
          title={s.title}
          value={s.value}
          subtitle={s.subtitle}
          icon={s.icon}
          subtitleColor={s.subtitleColor}
        />
      ))}
    </div>
  );
}

export default StatsRow;
