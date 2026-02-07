import cron, { ScheduledTask } from 'node-cron';
import { getSettings, ScheduleConfig } from './storage';
import { triggerBackup } from '@/app/actions';

// We need to track multiple tasks
let scheduledTasks: Record<string, ScheduledTask> = {};

export function initScheduler() {
    const settings = getSettings();

    // Clear all existing tasks
    Object.values(scheduledTasks).forEach(task => task.stop());
    scheduledTasks = {};

    console.log('[Scheduler] Initializing Granular Schedules...');

    // Iterate through all container schedules
    for (const [containerId, config] of Object.entries(settings.containerSchedules)) {
        if (config.frequency === 'manual') continue;

        let cronExpression = '';
        const [hour, minute] = (config.time || '00:00').split(':');

        if (config.frequency === 'daily') {
            cronExpression = `${minute} ${hour} * * *`;
        } else if (config.frequency === 'weekly') {
            const day = config.dayOfWeek !== undefined ? config.dayOfWeek : 0; // Default Sunday
            cronExpression = `${minute} ${hour} * * ${day}`;
        }

        if (cronExpression) {
            console.log(`[Scheduler] Container ${containerId.substring(0, 8)}: ${config.frequency} at ${config.time} (Cron: ${cronExpression})`);

            const task = cron.schedule(cronExpression, async () => {
                console.log(`[Scheduler] Triggering backup for ${containerId}`);
                await triggerBackup([containerId]);
            });

            scheduledTasks[containerId] = task;
        }
    }
}
