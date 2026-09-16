import { describe, expect, test } from 'bun:test';

import { rawSha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';

import {
  projectDockerDesktopLoginStartSettingsStore
} from './windows-login-start.ts';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const evidence = Object.freeze({
  providerVersionDigest: rawSha256('docker-provider-version'),
  physicalObservationReceiptDigest: rawSha256('settings-file-physical-receipt')
});

describe('Docker Desktop login-start settings projection', () => {
  test('projects enabled and disabled from the Docker-owned setting', () => {
    const enabled = projectDockerDesktopLoginStartSettingsStore(
      encode('{"AutoStart":true,"x":1}'), evidence
    );
    const enabledWithUnrelatedChange = projectDockerDesktopLoginStartSettingsStore(
      encode('{"AutoStart":true,"x":2}'), evidence
    );
    const enabledAfterPhysicalReadback = projectDockerDesktopLoginStartSettingsStore(
      encode('{"AutoStart":true,"x":2}'),
      { ...evidence, physicalObservationReceiptDigest: rawSha256('next-physical-receipt') }
    );
    expect(enabled)
      .toMatchObject({
        status: 'observed-provider-value',
        value: 'enabled',
        schemaSupport: 'unsupported',
        reconciliation: 'schema-unsupported',
        configurationOwner: 'docker-desktop-settings-ui',
        automatedReconciliation: 'unsupported-by-admitted-provider'
      });
    expect(enabledWithUnrelatedChange).toMatchObject({
      semanticValueDigest: enabled.status === 'observed-provider-value'
        ? enabled.semanticValueDigest
        : null
    });
    if (enabled.status !== 'observed-provider-value'
        || enabledAfterPhysicalReadback.status !== 'observed-provider-value') {
      throw new Error('Expected provider-value login-start projections.');
    }
    expect(enabledAfterPhysicalReadback.semanticValueDigest).toBe(enabled.semanticValueDigest);
    expect(enabledAfterPhysicalReadback.physicalObservationReceiptDigest)
      .not.toBe(enabled.physicalObservationReceiptDigest);
    expect(projectDockerDesktopLoginStartSettingsStore(encode('{"AutoStart":false}'), evidence))
      .toMatchObject({
        status: 'observed-provider-value',
        value: 'disabled',
        reconciliation: 'schema-unsupported'
      });
  });

  test('fails closed when the external settings shape is absent or invalid', () => {
    expect(projectDockerDesktopLoginStartSettingsStore(encode('{}'), evidence)).toMatchObject({
      status: 'unavailable',
      reason: 'settings-schema-unrecognized',
      reconciliation: 'observation-unavailable'
    });
    expect(projectDockerDesktopLoginStartSettingsStore(encode('{'), evidence)).toMatchObject({
      status: 'unavailable',
      reason: 'settings-store-invalid'
    });
    expect(projectDockerDesktopLoginStartSettingsStore(new Uint8Array(), evidence)).toMatchObject({
      status: 'unavailable',
      reason: 'settings-store-invalid'
    });
  });
});
