import cron, { ScheduledTask } from 'node-cron';
import { getSettings, ScheduleConfig } from './storage';
import { triggerBackup, triggerUnifiedStackBackup } from '@/app/actions';
import { backupQueue } from './queue';

// We need to track multiple tasks
let scheduledTasks: Record<string, ScheduledTask> = {};

export function initScheduler() {
    const settings = getSettings();

    // Clear all existing tasks
    Object.values(scheduledTasks).forEach(task => task.stop());
    scheduledTasks = {};

    console.log('[Scheduler] Initializing Granular Schedules...');

    // 1. Individual Container Schedules
    for (const [containerId, config] of Object.entries(settings.containerSchedules)) {
        if (config.frequency === 'manual') continue;

        const cronExpression = getCronExpression(config);
        if (cronExpression) {
            console.log(`[Scheduler] Container ${containerId.substring(0, 8)}: ${config.frequency} (Cron: ${cronExpression})`);
            const task = cron.schedule(cronExpression, async () => {
                console.log(`[Scheduler] Triggering individual backup for ${containerId}`);
                await triggerBackup([containerId]);
            });
            scheduledTasks[`container-${containerId}`] = task;
        }
    }

    // 2. Stack Schedules
    for (const [stackName, config] of Object.entries(settings.stackSchedules)) {
        if (config.frequency === 'manual') continue;

        const cronExpression = getCronExpression(config);
        if (cronExpression) {
            console.log(`[Scheduler] Stack ${stackName}: ${config.frequency} (Cron: ${cronExpression})`);
            const task = cron.schedule(cronExpression, async () => {
                console.log(`[Scheduler] Triggering UNIFIED stack backup for ${stackName} (via queue)`);
                backupQueue.add(async () => {
                    await triggerUnifiedStackBackup(stackName);
                });
            });
            scheduledTasks[`stack-${stackName}`] = task;
        }
    }
}

function getCronExpression(config: ScheduleConfig): string | null {
    if (!config.time) return null;
    const [hour, minute] = config.time.split(':');

    if (config.frequency === 'daily') {
        return `${minute} ${hour} * * *`;
    } else if (config.frequency === 'weekly') {
        const day = config.dayOfWeek !== undefined ? config.dayOfWeek : 0;
        return `${minute} ${hour} * * ${day}`;
    }
    return null;
}
