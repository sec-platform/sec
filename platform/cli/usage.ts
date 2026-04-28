export const USAGE = [
  'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|artifacts|install|blocks|postgres|doctor|deps|reference|benchmark|test|policy|acceptance|runtime|verification|provenance|review|demo|contract>',
  '',
  'Closed loop: npm run demo:closed-loop',
  'Readiness: platform doctor',
  'Governance paths: platform artifacts --paths --kind governance'
].join('\n');

export const INIT_USAGE = 'Usage: platform init [--reset]';
export const ADD_USAGE = 'Usage: platform add <block-id>';
export const VERIFY_USAGE = 'Usage: platform verify [--lane fast|runtime|all] [--json [--compact]]';
export const REPAIR_USAGE = 'Usage: platform repair ([--dry-run] [--json [--compact]]|plan [--json [--compact]])';
export const UPGRADE_USAGE = 'Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]';
export const LOCK_USAGE = 'Usage: platform lock [inspect [--json [--compact]]]';
export const EXPLAIN_USAGE = 'Usage: platform explain [--json [--compact]]|graph [--json [--compact]]';
export const ARTIFACTS_USAGE = 'Usage: platform artifacts (--json [--compact]|manifest [--json [--compact]]|--paths [--json [--compact]] [--kind governance|view|test|contract])';
export const INSTALL_USAGE = 'Usage: platform install manifest [--json [--compact]]';
export const BLOCKS_USAGE = 'Usage: platform blocks usage [--json [--compact]]';
export const POSTGRES_USAGE = 'Usage: platform postgres contract [--json [--compact]]';
export const DOCTOR_USAGE = 'Usage: platform doctor [--json [--compact]]';
export const REFERENCE_USAGE = 'Usage: platform reference check [--json [--compact]]';
export const BENCHMARK_USAGE = 'Usage: platform benchmark suite [--json [--compact]]';
export const TEST_USAGE = 'Usage: platform test budget [--json [--compact]]';
export const POLICY_USAGE = 'Usage: platform policy <report|sources> [--json [--compact]]';
export const ACCEPTANCE_USAGE = 'Usage: platform acceptance <coverage|blocks|slots> [--json [--compact]]';
export const RUNTIME_USAGE = 'Usage: platform runtime <report|steps> [--json [--compact]]';
export const VERIFICATION_USAGE = 'Usage: platform verification report [--json [--compact]]';
export const PROVENANCE_USAGE = 'Usage: platform provenance registry [--json [--compact]]';
export const REVIEW_USAGE = 'Usage: platform review <summary|matrix> [--json [--compact]]';
export const DEMO_USAGE = 'Usage: platform demo checklist [--json [--compact]]';
export const CONTRACT_USAGE = 'Usage: platform contract <freeze|errors|ci> [--json [--compact]]';
export const DEPS_USAGE = [
  'Usage: platform deps <status|warmup|relink|clean>',
  '  platform deps status [--json [--compact]]',
  '  platform deps warmup [--json [--compact]]',
  '  platform deps relink project [--json [--compact]]',
  '  platform deps clean [--project|--shared|--npm-cache]',
  '  platform deps clean --all --force'
].join('\n');
