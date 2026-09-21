export type AcceptanceInspectionTargetSource = Readonly<{
  id: string;
  declaredAcceptance: readonly string[];
  coveredBy: readonly string[];
  uncovered: boolean;
}>;

export type AcceptanceInspectionProjectionSource = Readonly<{
  status: string;
  acceptancePassed: readonly string[];
  blocks: readonly AcceptanceInspectionTargetSource[];
  uncoveredBlocks: readonly string[];
}>;

export type AcceptanceInspectionTargetView = {
  id: string;
  declaredAcceptance: string[];
  coveredBy: string[];
  uncovered: boolean;
  declaredAcceptanceCount: number;
  coveredByCount: number;
};

export type AcceptanceTargetInspect = {
  status: string;
  targetKind: 'blocks';
  targetCount: number;
  coveredCount: number;
  uncoveredCount: number;
  uncoveredIds: string[];
  targets: AcceptanceInspectionTargetView[];
};

export type AcceptanceCoverageInspectView = Readonly<{
  status: string;
  acceptancePassedCount: number;
  blockTargets: AcceptanceTargetInspect;
}>;

export function projectAcceptanceTargets(
  source: AcceptanceInspectionProjectionSource
): AcceptanceTargetInspect {
  const targets = source.blocks.map((entry) => {
    const captured = { ...entry };
    const declaredAcceptance = [...captured.declaredAcceptance];
    const coveredBy = [...captured.coveredBy];
    return {
      ...captured,
      declaredAcceptance,
      coveredBy,
      declaredAcceptanceCount: declaredAcceptance.length,
      coveredByCount: coveredBy.length
    };
  });
  const uncoveredIds = [...source.uncoveredBlocks];
  return {
    status: source.status,
    targetKind: 'blocks',
    targetCount: targets.length,
    coveredCount: targets.filter((target) => !target.uncovered).length,
    uncoveredCount: uncoveredIds.length,
    uncoveredIds,
    targets
  };
}

export function projectAcceptanceCoverage(
  source: AcceptanceInspectionProjectionSource
): AcceptanceCoverageInspectView {
  return {
    status: source.status,
    acceptancePassedCount: source.acceptancePassed.length,
    blockTargets: projectAcceptanceTargets(source)
  };
}
