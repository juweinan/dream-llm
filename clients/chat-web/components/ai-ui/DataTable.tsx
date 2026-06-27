import type { UITable } from '@/types/ai-ui';

interface Props {
  table: UITable;
}

const alignClass: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

export default function DataTable({ table }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {table.columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 text-xs font-semibold uppercase text-gray-500 ${
                  alignClass[col.align ?? 'left']
                }`}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
            >
              {table.columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 text-gray-700 ${alignClass[col.align ?? 'left']}`}
                >
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
