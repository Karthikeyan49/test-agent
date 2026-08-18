interface RecordCountProps {
  count: number;
  label?: string;
  className?: string;
}

export function RecordCount({ count, label = 'records', className }: RecordCountProps) {
  return (
    <span className={`text-xs text-muted-foreground ml-auto ${className ?? ''}`}>
      {count.toLocaleString('en-IN')} {label}
    </span>
  );
}

export default RecordCount;
