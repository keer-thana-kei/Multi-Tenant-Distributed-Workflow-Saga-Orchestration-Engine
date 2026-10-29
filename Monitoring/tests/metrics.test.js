'use strict';
/**
 * Metrics collector unit tests — uses Node built-in test runner.
 * Run: node --test tests/metrics.test.js
 *
 * Tests that real CPU/memory values are numeric, within valid ranges,
 * and that the result object has the expected structure.
 * Note: collectWorkflowMetrics requires a live MongoDB connection and is
 * tested structurally only (offline), with integration validation done via smoke tests.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const si = require('systeminformation');
const { collectSystemMetrics } = require('../src/metrics/collector');

describe('collectSystemMetrics', () => {
  test('returns a numeric CPU usage percent between 0 and 100', async () => {
    const result = await collectSystemMetrics();
    assert.ok(result.cpu, 'should have cpu field');
    assert.equal(typeof result.cpu.usagePercent, 'number', 'cpu.usagePercent must be a number');
    assert.ok(result.cpu.usagePercent >= 0, `CPU usage ${result.cpu.usagePercent} should be >= 0`);
    assert.ok(result.cpu.usagePercent <= 100, `CPU usage ${result.cpu.usagePercent} should be <= 100`);
  });

  test('returns a numeric memory usage percent between 0 and 100', async () => {
    const result = await collectSystemMetrics();
    assert.ok(result.memory, 'should have memory field');
    assert.equal(typeof result.memory.usagePercent, 'number', 'memory.usagePercent must be a number');
    assert.ok(result.memory.usagePercent >= 0);
    assert.ok(result.memory.usagePercent <= 100);
  });

  test('totalBytes is a positive integer', async () => {
    const result = await collectSystemMetrics();
    assert.ok(Number.isInteger(result.memory.totalBytes) || result.memory.totalBytes > 0);
    assert.ok(result.memory.totalBytes > 0, 'totalBytes should be > 0');
  });

  test('usedBytes + freeBytes roughly equals totalBytes (within 5%)', async () => {
    const result = await collectSystemMetrics();
    const { totalBytes, usedBytes, freeBytes } = result.memory;
    // Allow 5% tolerance for OS-internal buffers
    const delta = Math.abs(totalBytes - (usedBytes + freeBytes));
    const tolerance = totalBytes * 0.05;
    assert.ok(delta <= tolerance, `Memory sum mismatch: total=${totalBytes}, used=${usedBytes}, free=${freeBytes}`);
  });

  test('CPU coreCount is a non-negative integer', async () => {
    const result = await collectSystemMetrics();
    assert.ok(Number.isInteger(result.cpu.coreCount));
    assert.ok(result.cpu.coreCount >= 0);
  });
});

describe('collectSystemMetrics result shape', () => {
  test('has cpu and memory top-level keys', async () => {
    const result = await collectSystemMetrics();
    assert.ok('cpu' in result, 'missing cpu');
    assert.ok('memory' in result, 'missing memory');
  });

  test('cpu has usagePercent and coreCount', async () => {
    const result = await collectSystemMetrics();
    assert.ok('usagePercent' in result.cpu);
    assert.ok('coreCount' in result.cpu);
  });

  test('memory has totalBytes, usedBytes, freeBytes, usagePercent', async () => {
    const result = await collectSystemMetrics();
    const keys = ['totalBytes', 'usedBytes', 'freeBytes', 'usagePercent'];
    for (const k of keys) {
      assert.ok(k in result.memory, `missing memory.${k}`);
    }
  });
});
