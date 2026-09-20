export type VerificationReportInspectProjectionSource = Readonly<{
  summary: Readonly<{
    status: string;
    requestedLane: string;
    failedLanes: readonly string[];
  }>;
  fast: Readonly<{
    status: string;
    build: Readonly<{ status: string }>;
    unit: Readonly<{ status: string }>;
    acceptance: Readonly<{ status: string }>;
    policy: Readonly<{ status: string }>;
  }>;
  runtime: Readonly<{
    status: string;
    build: Readonly<{ status: string }>;
    unit: Readonly<{ status: string }>;
    acceptance: Readonly<{ status: string }>;
  }>;
}>;

export type VerificationReportInspectView = Readonly<{
  status: string;
  requestedLane: string;
  failedLanes: readonly string[];
  fast: Readonly<{
    status: string;
    buildStatus: string;
    unitStatus: string;
    acceptanceStatus: string;
    policyStatus: string;
  }>;
  runtime: Readonly<{
    status: string;
    buildStatus: string;
    unitStatus: string;
    acceptanceStatus: string;
  }>;
}>;

export function projectVerificationReportInspect(
  source: VerificationReportInspectProjectionSource
): VerificationReportInspectView {
  return {
    status: source.summary.status,
    requestedLane: source.summary.requestedLane,
    failedLanes: [...source.summary.failedLanes],
    fast: {
      status: source.fast.status,
      buildStatus: source.fast.build.status,
      unitStatus: source.fast.unit.status,
      acceptanceStatus: source.fast.acceptance.status,
      policyStatus: source.fast.policy.status
    },
    runtime: {
      status: source.runtime.status,
      buildStatus: source.runtime.build.status,
      unitStatus: source.runtime.unit.status,
      acceptanceStatus: source.runtime.acceptance.status
    }
  };
}
