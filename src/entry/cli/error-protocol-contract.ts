import type { ErrorProtocolContract } from '../../application/error-protocol-contract.ts';

export function formatErrorProtocolContract(contract: ErrorProtocolContract): string {
  return [
    `Error protocol ${contract.status}`,
    `Command: ${contract.command}`,
    `Examples: ${contract.exampleCount}`,
    `Issue type count: ${contract.issueTypeCount}`,
    `Issue types: ${contract.issueTypes.join(', ')}`,
    `Suggested actions: ${contract.suggestedActionCount}`,
    `Artifact paths: ${contract.artifactPathCount}`,
    `Artifact path list: ${contract.artifactPaths.join(', ')}`,
    ...contract.examples.map((example) => [
      `Example ${example.id}`,
      `code=${example.output.code}`,
      `recoverable=${example.output.recoverable}`,
      `issueType=${example.output.issueType}`,
      `actions=${example.output.suggestedActions.join(', ')}`
    ].join('; '))
  ].join('\n');
}
