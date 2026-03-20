import type { ScheduleConfig } from './storage';

export interface HalfHourSlot {
    index: number;
    start: string;
    end: string;
    label: string;
}

export interface ScheduleSlotSummary {
    frequency: 'daily' | 'weekly';
    frequencyLabel: string;
    slotIndex: number;
    slotLabel: string;
    dayOfWeek?: number;
    dayLabel?: string;
    key: string;
}

export interface SlotOccupancy {
    count: number;
    stackNames: string[];
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function padTime(value: number) {
    return value.toString().padStart(2, '0');
}

function formatTime(totalMinutes: number) {
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${padTime(hours)}:${padTime(minutes)}`;
}

export const HALF_HOUR_SLOTS: HalfHourSlot[] = Array.from({ length: 48 }, (_, index) => {
    const startMinutes = index * 30;
    const endMinutes = startMinutes + 30;
    const start = formatTime(startMinutes);
    const end = formatTime(endMinutes);

    return {
        index,
        start,
        end,
        label: `${start}-${end}`,
    };
});

export function timeToSlotIndex(time?: string) {
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
    const [hoursRaw, minutesRaw] = time.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);

    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return Math.floor((hours * 60 + minutes) / 30);
}

export function slotIndexToTime(slotIndex: number) {
    const normalized = Math.max(0, Math.min(47, Math.floor(slotIndex)));
    return HALF_HOUR_SLOTS[normalized].start;
}

export function getDayLabel(dayOfWeek?: number) {
    if (dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) return undefined;
    return DAY_LABELS[dayOfWeek];
}

export function getScheduleSlotSummary(config?: ScheduleConfig | null): ScheduleSlotSummary | null {
    if (!config || config.frequency === 'manual') return null;

    const slotIndex = timeToSlotIndex(config.time);
    if (slotIndex === null) return null;

    const slotLabel = HALF_HOUR_SLOTS[slotIndex].label;

    if (config.frequency === 'daily') {
        return {
            frequency: 'daily',
            frequencyLabel: 'Daily',
            slotIndex,
            slotLabel,
            dayOfWeek: undefined,
            dayLabel: undefined,
            key: `daily:${slotIndex}`,
        };
    }

    const dayOfWeek = config.dayOfWeek ?? 0;
    const dayLabel = getDayLabel(dayOfWeek);
    return {
        frequency: 'weekly',
        frequencyLabel: `Weekly ${dayLabel}`,
        slotIndex,
        slotLabel,
        dayOfWeek,
        dayLabel,
        key: `weekly:${dayOfWeek}:${slotIndex}`,
    };
}

export function getScheduleOccupancy(
    schedules: Record<string, ScheduleConfig>,
    options: {
        frequency: 'daily' | 'weekly';
        dayOfWeek?: number;
        excludeStackName?: string;
    }
) {
    const occupancy: Record<number, SlotOccupancy> = {};

    for (const [stackName, config] of Object.entries(schedules)) {
        if (stackName === options.excludeStackName) continue;

        const summary = getScheduleSlotSummary(config);
        if (!summary) continue;

        if (options.frequency === 'daily' && summary.frequency !== 'daily') continue;
        if (options.frequency === 'weekly') {
            if (summary.frequency !== 'weekly') continue;
            if (summary.dayOfWeek !== options.dayOfWeek) continue;
        }

        const current = occupancy[summary.slotIndex] ?? { count: 0, stackNames: [] };
        occupancy[summary.slotIndex] = {
            count: current.count + 1,
            stackNames: [...current.stackNames, stackName],
        };
    }

    return occupancy;
}
