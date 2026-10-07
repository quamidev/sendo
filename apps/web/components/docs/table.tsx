import type { ReactNode } from "react";

export function Table({ head, rows }: { head: readonly ReactNode[]; rows: readonly ReactNode[][] }) {
  return (
    <div className="my-5 overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead className="bg-muted/50">
          <tr>
            {head.map((cell, i) => (
              <th key={i} scope="col" className="px-3 py-2 align-bottom font-medium whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t align-top">
              {row.map((cell, c) => (
                <td key={c} className="px-3 py-2 leading-relaxed [&_code]:whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
