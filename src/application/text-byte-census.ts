export type TextByteCensusCountView = Readonly<{
  id: string;
  count: number;
}>;

export type TextByteCensusFlaggedEntryView = Readonly<{
  path: string;
  classification: string;
  anomalies: readonly string[];
}>;

export type TextByteCensusView = Readonly<{
  totalFiles: number;
  failClosed: boolean;
  classifications: readonly TextByteCensusCountView[];
  anomalies: readonly TextByteCensusCountView[];
  flaggedEntries: readonly TextByteCensusFlaggedEntryView[];
}>;

export type TextByteCensusVocabulary<C extends string, A extends string> = Readonly<{
  classifications: readonly C[];
  anomalies: readonly A[];
}>;

export type TextByteCensusProjectionSource<C extends string, A extends string> = Readonly<{
  totalFiles: number;
  failClosed: boolean;
  classificationCounts: Readonly<Record<C, number>>;
  anomalyCounts: Readonly<Record<A, number>>;
  flaggedEntries: readonly Readonly<{
    path: string;
    classification: C;
    anomalies: readonly A[];
  }>[];
}>;

export function projectTextByteCensusReport<C extends string, A extends string>(
  report: TextByteCensusProjectionSource<C, A>,
  vocabulary: TextByteCensusVocabulary<C, A>
): TextByteCensusView {
  return {
    totalFiles: report.totalFiles,
    failClosed: report.failClosed,
    classifications: vocabulary.classifications
      .filter((classification) => report.classificationCounts[classification] > 0)
      .map((classification) => ({ id: classification, count: report.classificationCounts[classification] })),
    anomalies: vocabulary.anomalies
      .filter((anomaly) => report.anomalyCounts[anomaly] > 0)
      .map((anomaly) => ({ id: anomaly, count: report.anomalyCounts[anomaly] })),
    flaggedEntries: report.flaggedEntries.map((entry) => ({
      path: entry.path,
      classification: entry.classification,
      anomalies: [...entry.anomalies]
    }))
  };
}
