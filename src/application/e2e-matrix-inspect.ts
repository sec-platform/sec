export type E2eMatrixProjectionSource = Readonly<{
  status: string;
  rowCount: number;
  rows: readonly Readonly<{
    stage: string;
    status: string;
    detail: string;
    evidenceCount: number;
    evidence: readonly string[];
  }>[];
}>;

export type E2eMatrixInspectView = Readonly<{
  status: string;
  rowCount: number;
  rows: readonly Readonly<{
    stage: string;
    status: string;
    detail: string;
    evidenceCount: number;
    evidence: readonly string[];
  }>[];
}>;

export function projectE2eMatrix(source: E2eMatrixProjectionSource): E2eMatrixInspectView {
  return {
    status: source.status,
    rowCount: source.rowCount,
    rows: source.rows.map((row) => ({
      stage: row.stage,
      status: row.status,
      detail: row.detail,
      evidenceCount: row.evidenceCount,
      evidence: [...row.evidence]
    }))
  };
}
