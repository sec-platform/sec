import { expect, test } from 'bun:test';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('microservice core pass depends on binding contract, not the default provider implementation', async () => {
  const source = await readCompilerFile('platform/compiler/compose/microservice-lower-pass.ts');

  expect(source).toContain("from './microservice-deployment-provider.ts'");
  expect(source).not.toContain("from './microservice-next-bun-docker-adapter.ts'");
  expect(source).not.toContain("from './microservice-deployment-policy.ts'");
  for (const providerPrivateText of [
    'nextBunDockerMicroserviceRenderer',
    'DEFAULT_MICROSERVICE_RESILIENCE_POLICY',
    'next/server',
    'Dockerfile',
    'FROM bun:',
    'SERVICE_HOST_',
    'PORT=3000',
    'NODE_ENV=production',
    'CircuitBreaker',
    'maxRetries'
  ]) {
    expect(source).not.toContain(providerPrivateText);
  }
});

test('default provider selection is isolated in one compatibility binding owner', async () => {
  const source = await readCompilerFile('platform/compiler/compose/microservice-deployment-provider.ts');

  expect(source).toContain('nextBunDockerMicroserviceRenderer');
  expect(source).toContain('DEFAULT_MICROSERVICE_RESILIENCE_POLICY');
  expect(source).toContain('defaultMicroserviceDeploymentBinding');
});
