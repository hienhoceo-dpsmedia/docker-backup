import type { BackupResourceFdPid, BackupResourceUsage } from './storage';

function roundMetric(value: number, digits: number = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

export function parseCpuPercent(stats: any): number {
    const cpuDelta =
        (stats?.cpu_stats?.cpu_usage?.total_usage || 0) -
        (stats?.precpu_stats?.cpu_usage?.total_usage || 0);
    const systemDelta =
        (stats?.cpu_stats?.system_cpu_usage || 0) -
        (stats?.precpu_stats?.system_cpu_usage || 0);
    const onlineCpus =
        stats?.cpu_stats?.online_cpus ||
        stats?.cpu_stats?.cpu_usage?.percpu_usage?.length ||
        1;

    if (cpuDelta > 0 && systemDelta > 0) {
        return (cpuDelta / systemDelta) * onlineCpus * 100;
    }
    return 0;
}

export function summarizeRuntimeSnapshots(stats: Array<{ cpuPct: number; memMB: number } | null>) {
    let cpuPeak = 0;
    let memTotal = 0;

    for (const snapshot of stats) {
        if (!snapshot) continue;
        cpuPeak = Math.max(cpuPeak, snapshot.cpuPct);
        memTotal += snapshot.memMB;
    }

    return { cpuPeak, memTotal };
}

export function calculateDiskUtilizationPercentFromSamples(
    start: Map<string, number>,
    end: Map<string, number>,
    sampleMs: number
): number | null {
    if (start.size === 0 || sampleMs <= 0) return null;

    let maxUtil = 0;
    start.forEach((startIoMs, name) => {
        const endIoMs = end.get(name);
        if (endIoMs === undefined) return;
        const delta = Math.max(0, endIoMs - startIoMs);
        const util = (delta / sampleMs) * 100;
        if (util > maxUtil) maxUtil = util;
    });

    return maxUtil;
}

export function buildResourceUsageSummary(input: {
    durationSec: number;
    hostLoadAvg: number;
    hostLoadPeak: number;
    targetCpuAvgPct: number;
    targetCpuPeakPct: number;
    targetMemPeakMB: number;
    appRssPeakMB: number;
    sampleCount: number;
    fdByPid?: BackupResourceFdPid[];
}): BackupResourceUsage {
    return {
        durationSec: roundMetric(input.durationSec, 1),
        hostLoadAvg: roundMetric(input.hostLoadAvg),
        hostLoadPeak: roundMetric(input.hostLoadPeak),
        targetCpuAvgPct: roundMetric(input.targetCpuAvgPct),
        targetCpuPeakPct: roundMetric(input.targetCpuPeakPct),
        targetMemPeakMB: roundMetric(input.targetMemPeakMB, 1),
        appRssPeakMB: roundMetric(input.appRssPeakMB, 1),
        sampleCount: input.sampleCount,
        fdByPid: input.fdByPid && input.fdByPid.length > 0 ? input.fdByPid : undefined,
    };
}
