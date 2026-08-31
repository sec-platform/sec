import { expect, test } from 'bun:test';

import { createDockerEndpointIdentity } from '../contract/daemon.ts';
import { compileContainerEngineOperationArguments } from './container-engine-session.ts';

const endpoint = createDockerEndpointIdentity({
  architecture: 'x86_64',
  contextName: 'desktop-linux',
  daemonId: 'daemon-test',
  endpointHost: 'npipe:////./pipe/dockerDesktopLinuxEngine',
  osType: 'linux'
});

test('Container Engine projection injects the retained endpoint outside caller arguments', () => {
  expect(compileContainerEngineOperationArguments(endpoint, {
    kind: 'container-list',
    arguments: ['--all']
  })).toEqual([
    '--host',
    endpoint.endpointHost,
    'container',
    'ls',
    '--all'
  ]);
});

test('Container Engine callers cannot replace the retained endpoint', () => {
  expect(() => compileContainerEngineOperationArguments(endpoint, {
    kind: 'container-list',
    arguments: ['--host', 'npipe:////./pipe/attacker']
  })).toThrow('operation cannot replace the retained endpoint');
});
