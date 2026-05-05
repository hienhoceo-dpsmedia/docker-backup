import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildResourceUsageSummary,
    calculateDiskUtilizationPercentFromSamples,
    parseCpuPercent,
    summarizeRuntimeSnapshots,
} from './resource-tracking';

test('summarizes container runtime snapshots by cpu peak and memory total', () => {
    assert.deepEqual(summarizeRuntimeSnapshots([
        { cpuPct: 20, memMB: 100 },
        null,
        { cpuPct: 55, memMB: 220 },
    ]), {
        cpuPeak: 55,
        memTotal: 320,
    });
});

test('calculates disk utilization percentage from io time samples', () => {
    const util = calculateDiskUtilizationPercentFromSamples(
        new Map([['sda', 100], ['nvme0n1', 50]]),
        new Map([['sda', 250], ['nvme0n1', 90]]),
        1000
    );

    assert.equal(util, 15);
});

test('parses docker cpu stats into a usage percent', () => {
    const cpuPct = parseCpuPercent({
        cpu_stats: {
            cpu_usage: { total_usage: 400 },
            system_cpu_usage: 1400,
            online_cpus: 2,
        },
        precpu_stats: {
            cpu_usage: { total_usage: 100 },
            system_cpu_usage: 800,
        },
    });

    assert.equal(cpuPct, 100);
});

test('builds a rounded resource usage summary and omits empty fd telemetry', () => {
    assert.deepEqual(buildResourceUsageSummary({
        durationSec: 12.345,
        hostLoadAvg: 1.234,
        hostLoadPeak: 2.345,
        targetCpuAvgPct: 44.444,
        targetCpuPeakPct: 70.777,
        targetMemPeakMB: 512.89,
        appRssPeakMB: 222.29,
        sampleCount: 4,
        fdByPid: [],
    }), {
        durationSec: 12.3,
        hostLoadAvg: 1.23,
        hostLoadPeak: 2.35,
        targetCpuAvgPct: 44.44,
        targetCpuPeakPct: 70.78,
        targetMemPeakMB: 512.9,
        appRssPeakMB: 222.3,
        sampleCount: 4,
        fdByPid: undefined,
    });
});
