interface InlineFieldProps {
  label: string;
  value?: string | number | boolean | null;
  display?: string;
}

export function InlineField({ label, value, display }: InlineFieldProps) {
  let text: string;
  if (display !== undefined) {
    text = display;
  } else if (value == null || value === '') {
    text = '—';
  } else if (typeof value === 'boolean') {
    text = value ? 'Yes' : 'No';
  } else {
    text = String(value);
  }

  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm text-card-foreground mt-0.5">{text}</dd>
    </div>
  );
}

export default InlineField;
