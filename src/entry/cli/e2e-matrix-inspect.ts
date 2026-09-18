import type { E2eMatrixInspectView } from '../../application/e2e-matrix-inspect.ts';
import { formatFields, formatList } from './format-utils.ts';

function formatE2eMatrixRow(row: E2eMatrixInspectView['rows'][number]): string {
  return formatFields([
    `${row.stage}: ${row.status}`,
    row.detail,
    `evidence=${formatList([...row.evidence])}`
  ]);
}

export function formatE2eMatrix(view: E2eMatrixInspectView): string {
  return [
    `E2E matrix ${view.status}; rows=${view.rowCount}`,
    ...view.rows.map((row) => formatE2eMatrixRow(row))
  ].join('\n');
}
