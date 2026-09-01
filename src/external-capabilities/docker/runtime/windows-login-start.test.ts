import { describe, expect, test } from 'bun:test';

import {
  projectDockerDesktopLoginStartSettingsStore
} from './windows-login-start.ts';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('Docker Desktop login-start settings projection', () => {
  test('projects enabled and disabled from the Docker-owned setting', () => {
    expect(projectDockerDesktopLoginStartSettingsStore(encode('{"AutoStart":true,"x":1}')))
      .toMatchObject({
        status: 'enabled',
        reconciliation: 'satisfied',
        configurationOwner: 'docker-desktop-settings-ui',
        automatedReconciliation: 'unsupported-by-admitted-provider'
      });
    expect(projectDockerDesktopLoginStartSettingsStore(encode('{"AutoStart":false}')))
      .toMatchObject({
        status: 'disabled',
        reconciliation: 'docker-desktop-settings-ui-required'
      });
  });

  test('fails closed when the external settings shape is absent or invalid', () => {
    expect(projectDockerDesktopLoginStartSettingsStore(encode('{}'))).toMatchObject({
      status: 'unavailable',
      reason: 'auto-start-setting-unavailable',
      reconciliation: 'observation-unavailable'
    });
    expect(projectDockerDesktopLoginStartSettingsStore(encode('{'))).toMatchObject({
      status: 'unavailable',
      reason: 'settings-store-invalid'
    });
    expect(projectDockerDesktopLoginStartSettingsStore(new Uint8Array())).toMatchObject({
      status: 'unavailable',
      reason: 'settings-store-invalid'
    });
  });
});
