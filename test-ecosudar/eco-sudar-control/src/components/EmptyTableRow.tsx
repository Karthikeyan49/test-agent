interface EmptyTableRowProps {
  colSpan: number;
  message?: string;
}

export function EmptyTableRow({ colSpan, message = 'No records found' }: EmptyTableRowProps) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-6 py-8 text-center text-muted-foreground text-sm"
      >
        {message}
      </td>
    </tr>
  );
}

export default EmptyTableRow;
