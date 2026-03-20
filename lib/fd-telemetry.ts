import type { BackupResourceFdPid } from './storage';

export interface ContainerFdSnapshotRow {
    pid: number;
    fdCount: number;
    fdLimit: number | null;
    fdUtilPct: number | null;
    comm?: string;
}

interface FdPeakEntry {
    containerId: string;
    pid: number;
    comm?: string;
    fdPeak: number;
    fdLimit: number | null;
    fdUtilPeak: number | null;
}

export type FdPeakMap = Map<string, FdPeakEntry>;

export function createEmptyFdPeakMap(): FdPeakMap {
    return new Map();
}

export function parseContainerFdSnapshotOutput(stdout: string): ContainerFdSnapshotRow[] {
    const rows = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const out: ContainerFdSnapshotRow[] = [];
    for (const row of rows) {
        const [pidRaw, fdRaw, limitRaw, utilRaw, commRaw] = row.split(',');
        const pid = Number(pidRaw);
        const fdCount = Number(fdRaw);
        const fdLimit = Number(limitRaw);
        const fdUtilPct = utilRaw ? Number(utilRaw) : null;
        if (!Number.isFinite(pid) || !Number.isFinite(fdCount)) continue;
        out.push({
            pid,
            fdCount,
            fdLimit: Number.isFinite(fdLimit) && fdLimit > 0 ? fdLimit : null,
            fdUtilPct: fdUtilPct !== null && Number.isFinite(fdUtilPct) ? fdUtilPct : null,
            comm: commRaw || undefined,
        });
    }
    return out;
}

export function mergeFdPeakSnapshots(peakMap: FdPeakMap, containerId: string, rows: ContainerFdSnapshotRow[]) {
    for (const row of rows) {
        const key = `${containerId}:${row.pid}`;
        const previous = peakMap.get(key);
        peakMap.set(key, {
            containerId,
            pid: row.pid,
            comm: row.comm || previous?.comm,
            fdPeak: Math.max(previous?.fdPeak || 0, row.fdCount),
            fdLimit: row.fdLimit ?? previous?.fdLimit ?? null,
            fdUtilPeak: row.fdUtilPct !== null
                ? Math.max(previous?.fdUtilPeak ?? 0, row.fdUtilPct)
                : previous?.fdUtilPeak ?? null,
        });
    }
}

export function finalizeFdPeaks(peakMap: FdPeakMap): BackupResourceFdPid[] {
    return Array.from(peakMap.values())
        .map((value) => ({
            containerId: value.containerId,
            pid: value.pid,
            fdPeak: value.fdPeak,
            fdLimit: value.fdLimit ?? undefined,
            fdUtilPeakPct: value.fdUtilPeak !== null ? value.fdUtilPeak : undefined,
            comm: value.comm,
        }))
        .sort((left, right) => {
            const leftUtil = left.fdUtilPeakPct ?? -1;
            const rightUtil = right.fdUtilPeakPct ?? -1;
            if (rightUtil !== leftUtil) return rightUtil - leftUtil;
            return right.fdPeak - left.fdPeak;
        });
}
