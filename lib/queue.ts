import PQueue from 'p-queue';

export type JobStatus = 'pending' | 'processing' | 'uploading' | 'completed' | 'failed';

interface JobState {
    status: JobStatus;
    message?: string;
    lastUpdated: number;
}

// Global State
const globalState: Record<string, JobState> = {};

// Create Queue with concurrency 1 (Sequential)
// We cast global to any to persist queue across hot reloads in dev
const globalForQueue = global as unknown as { backupQueue: PQueue };
export const backupQueue = globalForQueue.backupQueue || new PQueue({ concurrency: 1 });
if (process.env.NODE_ENV !== 'production') globalForQueue.backupQueue = backupQueue;

export function updateJobStatus(id: string, status: JobStatus, message?: string) {
    globalState[id] = {
        status,
        message,
        lastUpdated: Date.now()
    };
}

export function getJobStatus(id: string) {
    return globalState[id];
}

export function getAllJobs() {
    return globalState;
}
