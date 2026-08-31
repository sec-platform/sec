/**
 * The physical roots of one target workspace.
 *
 * This is deliberately a native layout contract. The compiler repository may
 * still contain historical fixtures, but a WorkspacePaths value never exposes
 * a second project/source/control tree for a target workspace. Artifact paths
 * are owned by the artifact contract; this type only exposes the single `.sec`
 * and `.sec/artifacts` roots needed to resolve them.
 */
export interface WorkspacePaths {
  readonly workspaceRoot: string;
  readonly workspaceConfigPath: string;
  readonly modelRoot: string;
  readonly modelBlocksRoot: string;
  readonly privateRegistryRoot: string;
  readonly policiesRoot: string;
  readonly overridesRoot: string;
  readonly srcRoot: string;
  readonly slotsRoot: string;
  readonly testsRoot: string;
  readonly packageJsonPath: string;
  readonly tsconfigPath: string;
  readonly prismaRoot: string;
  readonly secRoot: string;
  readonly artifactsRoot: string;
  readonly cacheRoot: string;
  readonly workspaceWriteLeaseRoot: string;
}
