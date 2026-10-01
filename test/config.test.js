import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const baseEnv = {
  ALLOWED_ORIGINS: 'https://store.example',
  GOOGLE_MAPS_API_KEY: 'google-key',
};

test('Smarty is the default provider for domestic and international addresses', () => {
  const config = loadConfig({
    ALLOWED_ORIGINS: 'https://store.example',
    SMARTY_AUTH_ID: 'smarty-id',
    SMARTY_AUTH_TOKEN: 'smarty-token',
  });
  assert.equal(config.domesticProvider, 'smarty');
  assert.equal(config.internationalProvider, 'smarty');
});

test('requires credentials only for selected providers', () => {
  const smartyConfig = loadConfig({
    ALLOWED_ORIGINS: 'https://store.example',
    DOMESTIC_VALIDATION_PROVIDER: 'smarty',
    INTERNATIONAL_VALIDATION_PROVIDER: 'smarty',
    SMARTY_AUTH_ID: 'smarty-id',
    SMARTY_AUTH_TOKEN: 'smarty-token',
  });
  assert.equal(smartyConfig.domesticProvider, 'smarty');
  assert.equal(smartyConfig.internationalProvider, 'smarty');

  const mixedConfig = loadConfig({
    ...baseEnv,
    DOMESTIC_VALIDATION_PROVIDER: 'smarty',
    INTERNATIONAL_VALIDATION_PROVIDER: 'google',
    SMARTY_AUTH_ID: 'smarty-id',
    SMARTY_AUTH_TOKEN: 'smarty-token',
  });
  assert.equal(mixedConfig.domesticProvider, 'smarty');
  assert.equal(mixedConfig.internationalProvider, 'google');

  assert.throws(
    () => loadConfig({
      ...baseEnv,
      DOMESTIC_VALIDATION_PROVIDER: 'smarty',
    }),
    /SMARTY_AUTH_ID, SMARTY_AUTH_TOKEN/,
  );
});

test('rejects unsupported provider settings', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, INTERNATIONAL_VALIDATION_PROVIDER: 'other' }),
    /INTERNATIONAL_VALIDATION_PROVIDER must be "google" or "smarty"/,
  );
});


test('numeric configuration requires a complete positive safe integer', () => {
  const env = { ...baseEnv, DOMESTIC_VALIDATION_PROVIDER: 'google', INTERNATIONAL_VALIDATION_PROVIDER: 'google' };
  for (const value of ['100abc', '1.5', '1e3', '-1', '0', '9007199254740992']) {
    assert.throws(() => loadConfig({ ...env, RATE_LIMIT_MAX: value }), /positive integer/);
  }
  assert.equal(loadConfig({ ...env, RATE_LIMIT_MAX: '100' }).rateLimitMax, 100);
});
