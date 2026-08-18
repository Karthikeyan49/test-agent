/**
 * Required-field marker. Site-wide standard: every compulsory form field's label
 * carries a red asterisk via <Req />, e.g. <Label>Name <Req /></Label>.
 */
export function Req() {
  return (
    <span className="text-destructive" aria-label="required" title="Required">
      *
    </span>
  );
}
