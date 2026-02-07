import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

export interface ScheduleConfig {
    frequency: 'manual' | 'daily' | 'weekly';
    time?: string; // "HH:mm" 24h format
    dayOfWeek?: number; // 0-6 (Sun-Sat) for weekly
}

export interface AppSettings {
    globalSchedule?: ScheduleConfig; // Legacy or default
    containerSchedules: Record<string, ScheduleConfig>; // key: containerId, value: config
    telegramEnabled: boolean;
    retentionCount: number;
}

export interface HistoryEntry {
    id: string;
    date: string;
    containerName: string;
    status: 'success' | 'failed';
    destination: 'local' | 'telegram' | 'cloud';
    message: string;
    size?: string;
    backupPath?: string; // Path for restore
}

const DEFAULT_SETTINGS: AppSettings = {
    containerSchedules: {},
    telegramEnabled: !!process.env.TELEGRAM_TOKEN,
    retentionCount: 5,
};

export function getSettings(): AppSettings {
    if (!fs.existsSync(SETTINGS_FILE)) return DEFAULT_SETTINGS;
    try {
        const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        // Migrate old settings if needed
        if (!data.containerSchedules) data.containerSchedules = {};
        return data;
    } catch {
        return DEFAULT_SETTINGS;
    }
}

export function saveSettings(settings: AppSettings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export function getHistory(): HistoryEntry[] {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch {
        return [];
    }
}

export function addHistoryEntry(entry: HistoryEntry) {
    const history = getHistory();
    history.unshift(entry); // Add to beginning
    // Limit history size
    if (history.length > 200) history.pop();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}
