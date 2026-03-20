import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createEmptyFdPeakMap,
    finalizeFdPeaks,
    mergeFdPeakSnapshots,
    parseContainerFdSnapshotOutput,
} from './fd-telemetry.ts';

test('parses fd snapshot rows and skips invalid lines', () => {
    const rows = parseContainerFdSnapshotOutput([
        '101,55,1024,5.37,node',
        '202,12,0,,postgres',
        'bad,line',
        '',
    ].join('\n'));

    assert.deepEqual(rows, [
        {
            pid: 101,
            fdCount: 55,
            fdLimit: 1024,
            fdUtilPct: 5.37,
            comm: 'node',
        },
        {
            pid: 202,
            fdCount: 12,
            fdLimit: null,
            fdUtilPct: null,
            comm: 'postgres',
        },
    ]);
});

test('merges snapshots by container and pid using the highest observed peaks', () => {
    const peakMap = createEmptyFdPeakMap();

    mergeFdPeakSnapshots(peakMap, 'alpha1234', [
        { pid: 11, fdCount: 50, fdLimit: 100, fdUtilPct: 50, comm: 'node' },
        { pid: 12, fdCount: 10, fdLimit: null, fdUtilPct: null, comm: 'bash' },
    ]);
    mergeFdPeakSnapshots(peakMap, 'alpha1234', [
        { pid: 11, fdCount: 70, fdLimit: 100, fdUtilPct: 70, comm: 'node' },
    ]);
    mergeFdPeakSnapshots(peakMap, 'bravo5678', [
        { pid: 22, fdCount: 30, fdLimit: 60, fdUtilPct: 50, comm: 'postgres' },
    ]);

    assert.deepEqual(finalizeFdPeaks(peakMap), [
        {
            containerId: 'alpha1234',
            pid: 11,
            fdPeak: 70,
            fdLimit: 100,
            fdUtilPeakPct: 70,
            comm: 'node',
        },
        {
            containerId: 'bravo5678',
            pid: 22,
            fdPeak: 30,
            fdLimit: 60,
            fdUtilPeakPct: 50,
            comm: 'postgres',
        },
        {
            containerId: 'alpha1234',
            pid: 12,
            fdPeak: 10,
            fdLimit: undefined,
            fdUtilPeakPct: undefined,
            comm: 'bash',
        },
    ]);
});
