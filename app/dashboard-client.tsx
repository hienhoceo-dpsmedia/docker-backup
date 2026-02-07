'use client';

import React, { useState, useEffect } from 'react';
import {
    LayoutDashboard,
    History,
    Settings,
    Box,
    Play,
    CheckCircle2,
    XCircle,
    Clock,
    Search,
    RefreshCw,
    Database,
    HardDrive,
    Trash2,
    Upload,
    ChevronRight,
    SearchCheck,
    AlertCircle,
    Info,
    Network,
    Plus,
    Activity
} from 'lucide-react';
import {
    getContainers,
    triggerBackup,
    getProgress,
    listBackups,
    restoreBackup,
    uploadBackup,
    restoreToNewContainer,
    getHistoryAction,
    getSettingsAction,
    saveSettingsAction,
    type AppSettings,
    type HistoryEntry
} from './actions';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface Container {
    Id: string;
    Names: string[];
    Image: string;
    State: string;
    Status: string;
    Labels: Record<string, string>;
}

interface BackupFile {
    id: string;
    name: string;
    size: string;
    date: string;
}

export default function DashboardClient({ initialContainers }: { initialContainers: Container[] }) {
    const [activeTab, setActiveTab] = useState<'containers' | 'history' | 'restore' | 'settings'>('containers');
    const [containers, setContainers] = useState<Container[]>(initialContainers);
    const [backups, setBackups] = useState<BackupFile[]>([]);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [progress, setProgress] = useState<Record<string, any>>({});
    const [selectedContainers, setSelectedContainers] = useState<string[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);

    // Filter containers based on search
    const filteredContainers = containers.filter(c =>
        c.Names[0].toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.Image.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const refreshData = async () => {
        setIsRefreshing(true);
        try {
            const [c, h, b, s] = await Promise.all([
                getContainers(),
                getHistoryAction(),
                listBackups(),
                getSettingsAction()
            ]);
            setContainers(c);
            setHistory(h);
            setBackups(b);
            setSettings(s);
        } finally {
            setIsRefreshing(false);
        }
    };

    // Polling for progress
    useEffect(() => {
        refreshData();
        const timer = setInterval(async () => {
            const p = await getProgress();
            setProgress(p);
        }, 2000);
        return () => clearInterval(timer);
    }, []);

    const handleBackup = async (ids: string[]) => {
        const res = await triggerBackup(ids);
        if (res.success) {
            setSelectedContainers([]);
            alert(`Started backup for ${res.count} containers`);
        }
    };

    const handleRestore = async (file: string, containerId: string) => {
        if (!confirm(`Are you sure you want to restore ${file} into ${containerId}? DATA MAY BE OVERWRITTEN.`)) return;

        setIsRestoring(true);
        const res = await restoreBackup(file, containerId);
        setIsRestoring(false);

        if (res.success) {
            alert('Restore completed successfully');
            refreshData();
        } else {
            alert(`Restore failed: ${res.error}`);
        }
    };

    const handleSmartRestore = async (file: string) => {
        if (!confirm(`This will attempt to clone the container(s) from ${file} with automatic conflict resolution. Proceed?`)) return;

        const jobId = `restore_${Date.now()}`;
        setProgress(prev => ({ ...prev, [jobId]: { status: 'processing', message: 'Initializing Smart Restore...' } }));
        setIsRestoring(true);

        try {
            const res = await restoreToNewContainer(file, undefined, jobId);
            if (res.success) {
                alert(res.message || 'Smart Restore completed successfully');
                refreshData();
            } else {
                alert(`Smart Restore failed: ${res.error}`);
            }
        } catch (err: any) {
            alert(`Execution error: ${err.message}`);
        } finally {
            setIsRestoring(false);
        }
    };

    const handleUploadClick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await uploadBackup(formData);
            if (res.success) {
                alert('Backup uploaded successfully');
                refreshData();
            } else {
                alert(`Upload failed: ${res.error}`);
            }
        } catch (err: any) {
            alert(`Upload error: ${err.message}`);
        } finally {
            setIsUploading(false);
            e.target.value = ''; // Reset input
        }
    };

    const toggleSelection = (id: string) => {
        setSelectedContainers(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    return (
        <div className="flex h-screen bg-[#020617] text-slate-200 overflow-hidden font-sans">
            {/* Sidebar */}
            <div className="w-72 bg-[#0b1120] border-r border-slate-800/50 flex flex-col">
                <div className="p-8 border-b border-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-500/20">
                            <Box className="w-6 h-6 text-white" />
                        </div>
                        <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                            Docker Guard
                        </h1>
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-2 mt-4">
                    <SidebarItem
                        icon={<LayoutDashboard className="w-5 h-5" />}
                        label="Dashboard"
                        active={activeTab === 'containers'}
                        onClick={() => setActiveTab('containers')}
                    />
                    <SidebarItem
                        icon={<History className="w-5 h-5" />}
                        label="History Log"
                        active={activeTab === 'history'}
                        onClick={() => setActiveTab('history')}
                    />
                    <SidebarItem
                        icon={<SearchCheck className="w-5 h-5" />}
                        label="Restore Center"
                        active={activeTab === 'restore'}
                        onClick={() => setActiveTab('restore')}
                    />
                    <SidebarItem
                        icon={<Settings className="w-5 h-5" />}
                        label="Settings"
                        active={activeTab === 'settings'}
                        onClick={() => setActiveTab('settings')}
                    />
                </nav>

                <div className="p-6 border-t border-slate-800/50">
                    <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800/50">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">System Status</span>
                        </div>
                        <p className="text-sm text-slate-300">Connected to Docker</p>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <main className="flex-1 overflow-auto bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-[#020617] to-[#020617]">
                <div className="p-10 max-w-7xl mx-auto">
                    {/* Header Action Bar */}
                    <div className="flex justify-between items-center mb-10">
                        <div>
                            <h2 className="text-3xl font-bold text-white mb-2 capitalize">{activeTab}</h2>
                            <p className="text-slate-400">Manage your infrastructure backups with confidence.</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={refreshData}
                                className={cn(
                                    "p-3 rounded-xl bg-slate-800/50 border border-slate-700 hover:bg-slate-700 transition-all",
                                    isRefreshing && "animate-spin"
                                )}
                            >
                                <RefreshCw className="w-5 h-5" />
                            </button>
                            {activeTab === 'containers' && selectedContainers.length > 0 && (
                                <button
                                    onClick={() => handleBackup(selectedContainers)}
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2"
                                >
                                    <Play className="w-4 h-4 fill-current" />
                                    Backup Selected ({selectedContainers.length})
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tab Contents */}
                    <div className="space-y-6">
                        {activeTab === 'containers' && (
                            <>
                                {/* Stats Row */}
                                <div className="grid grid-cols-4 gap-6 mb-8">
                                    <StatCard icon={<Box />} label="Total Containers" value={containers.length} color="blue" />
                                    <StatCard icon={<Activity />} label="Running" value={containers.filter(c => c.State === 'running').length} color="emerald" />
                                    <StatCard icon={<Database />} label="Databases" value={containers.filter(c => detectApp(c) === 'database').length} color="purple" />
                                    <StatCard icon={<HardDrive />} label="Last Backup" value={history.length > 0 ? format(new Date(history[0].date), 'HH:mm') : '--:--'} color="orange" />
                                </div>

                                <div className="relative mb-6">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                    <input
                                        type="text"
                                        placeholder="Search by container name or image..."
                                        className="w-full bg-[#0b1120] border border-slate-800 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-slate-200"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>

                                <div className="grid grid-cols-1 gap-4">
                                    {filteredContainers.map(container => (
                                        <ContainerRow
                                            key={container.Id}
                                            container={container}
                                            onBackup={() => handleBackup([container.Id])}
                                            progress={progress[container.Id]}
                                            isSelected={selectedContainers.includes(container.Id)}
                                            onToggle={() => toggleSelection(container.Id)}
                                        />
                                    ))}
                                </div>
                            </>
                        )}

                        {activeTab === 'history' && (
                            <div className="bg-[#0b1120]/50 border border-slate-800/80 rounded-2xl overflow-hidden backdrop-blur-sm">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="bg-slate-900/50 text-slate-400 text-xs uppercase tracking-widest border-b border-slate-800">
                                            <th className="px-6 py-4 font-semibold">Time</th>
                                            <th className="px-6 py-4 font-semibold">Container</th>
                                            <th className="px-6 py-4 font-semibold">Destination</th>
                                            <th className="px-6 py-4 font-semibold">Status</th>
                                            <th className="px-6 py-4 font-semibold">Size</th>
                                            <th className="px-6 py-4 font-semibold">Message</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {history.map(entry => (
                                            <tr key={entry.id} className="hover:bg-slate-800/30 transition-colors">
                                                <td className="px-6 py-4 text-sm text-slate-400">
                                                    {format(new Date(entry.date), 'MMM d, HH:mm:ss')}
                                                </td>
                                                <td className="px-6 py-4 font-medium text-slate-200">{entry.containerName}</td>
                                                <td className="px-6 py-4">
                                                    <span className="px-2 py-1 rounded-md bg-slate-800 text-[10px] font-bold uppercase text-slate-400">
                                                        {entry.destination}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {entry.status === 'success' ? (
                                                        <div className="flex items-center gap-2 text-emerald-400 text-sm">
                                                            <CheckCircle2 className="w-4 h-4" /> Success
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2 text-rose-400 text-sm">
                                                            <XCircle className="w-4 h-4" /> Failed
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-slate-300">{entry.size || '-'}</td>
                                                <td className="px-6 py-4 text-sm text-slate-400 italic max-w-xs truncate">{entry.message}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === 'restore' && (
                            <div className="space-y-8">
                                <div className="bg-blue-600/10 border border-blue-500/20 rounded-2xl p-6 flex items-start gap-4">
                                    <div className="p-3 bg-blue-600/20 rounded-xl">
                                        <Info className="w-6 h-6 text-blue-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-white mb-1">Smart Restore Technology</h3>
                                        <p className="text-slate-400 text-sm mb-4">
                                            Restore Center now supports <b>Automatic Cloning</b>. We'll handle port conflicts, preserve networks, and restore data into a NEW container automatically.
                                        </p>
                                        <div className="flex items-center gap-4">
                                            <label className={cn(
                                                "cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg font-medium transition-all flex items-center gap-2",
                                                isUploading && "opacity-50 pointer-events-none"
                                            )}>
                                                <Upload className="w-4 h-4" />
                                                {isUploading ? 'Uploading...' : 'Upload Backup (.zip)'}
                                                <input type="file" className="hidden" accept=".zip,.sql" onChange={handleUploadClick} />
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                {/* Active Processes for Restore */}
                                {Object.entries(progress).filter(([k, v]) => k.startsWith('restore_') && v.status === 'processing').map(([id, p]) => (
                                    <div key={id} className="bg-slate-800/50 border border-blue-500/30 rounded-xl p-4 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
                                            <div>
                                                <p className="text-sm font-medium text-white">Restoring infrastructure...</p>
                                                <p className="text-xs text-slate-400">{p.message}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {backups.map(file => (
                                        <div key={file.id} className="group bg-[#0b1120] border border-slate-800 rounded-2xl p-6 hover:border-slate-700 transition-all shadow-sm flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="p-4 bg-slate-900 rounded-xl group-hover:bg-slate-800 transition-colors">
                                                    <HardDrive className="w-8 h-8 text-blue-500" />
                                                </div>
                                                <div>
                                                    <h4 className="font-semibold text-white group-hover:text-blue-400 transition-colors mb-1 truncate max-w-[200px]" title={file.name}>
                                                        {file.name}
                                                    </h4>
                                                    <div className="flex items-center gap-3 text-xs text-slate-500">
                                                        <span className="flex items-center gap-1 font-mono uppercase bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                                            {file.size}
                                                        </span>
                                                        <span className="flex items-center gap-1">
                                                            <Clock className="w-3 h-3" /> {format(new Date(file.date), 'MMM d, HH:mm')}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleSmartRestore(file.name)}
                                                    className="p-2.5 bg-emerald-600/10 text-emerald-500 border border-emerald-500/30 rounded-xl hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
                                                    title="Restore to New Container (Clone)"
                                                >
                                                    <Plus className="w-5 h-5" />
                                                </button>
                                                <div className="relative group/menu">
                                                    <button
                                                        className="p-2.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-xl hover:bg-slate-700 hover:text-white transition-all flex items-center gap-2"
                                                    >
                                                        <ChevronRight className="w-5 h-5" />
                                                    </button>
                                                    {/* Dropdown for specific container restore */}
                                                    <div className="absolute right-0 top-full mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl opacity-0 invisible group-hover/menu:opacity-100 group-hover/menu:visible transition-all z-20 overflow-hidden">
                                                        <div className="p-3 border-b border-slate-800 bg-slate-800/50">
                                                            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Restore into existing</p>
                                                        </div>
                                                        <div className="max-h-60 overflow-y-auto">
                                                            {containers.filter(c => c.State === 'running').slice(0, 5).map(c => (
                                                                <button
                                                                    key={c.Id}
                                                                    onClick={() => handleRestore(file.name, c.Id)}
                                                                    className="w-full px-4 py-3 text-left text-sm hover:bg-blue-600 text-slate-300 hover:text-white transition-colors flex items-center gap-3 overflow-hidden"
                                                                >
                                                                    <Box className="w-4 h-4 flex-shrink-0" />
                                                                    <span className="truncate">{c.Names[0].replace('/', '')}</span>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'settings' && (
                            <div className="max-w-3xl space-y-8">
                                <div className="bg-[#0b1120] border border-slate-800 rounded-2xl p-8 shadow-sm">
                                    <h3 className="text-xl font-bold text-white mb-6">Backup Retention Policy</h3>
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between gap-8 p-4 bg-slate-900/50 rounded-xl border border-slate-800/50">
                                            <div>
                                                <p className="font-semibold text-slate-200">Local Retention</p>
                                                <p className="text-sm text-slate-500">Number of recent backups to keep on the VPS per container.</p>
                                            </div>
                                            <input
                                                type="number"
                                                className="w-24 bg-slate-800 border-none rounded-lg p-3 text-center focus:ring-2 focus:ring-blue-500"
                                                value={settings?.retentionCount || 5}
                                                onChange={(e) => {
                                                    const val = parseInt(e.target.value);
                                                    if (settings) {
                                                        const newS = { ...settings, retentionCount: val };
                                                        setSettings(newS);
                                                        saveSettingsAction(newS);
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-[#0b1120] border border-slate-800 rounded-2xl p-8 shadow-sm">
                                    <div className="flex items-center justify-between mb-8">
                                        <h3 className="text-xl font-bold text-white">Telegram Integration</h3>
                                        <div className={cn(
                                            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                                            settings?.telegramEnabled ? "bg-emerald-500/10 text-emerald-500" : "bg-slate-800 text-slate-500"
                                        )}>
                                            {settings?.telegramEnabled ? 'Configured' : 'Offline'}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="p-5 bg-slate-900/50 rounded-xl border border-slate-800/50">
                                            <p className="text-xs text-slate-500 mb-1 uppercase font-bold">Bot Token</p>
                                            <p className="text-sm text-slate-300 font-mono truncate">********************</p>
                                        </div>
                                        <div className="p-5 bg-slate-900/50 rounded-xl border border-slate-800/50">
                                            <p className="text-xs text-slate-500 mb-1 uppercase font-bold">Chat ID</p>
                                            <p className="text-sm text-slate-300 font-mono">{process.env.CHAT_ID || 'Not set'}</p>
                                        </div>
                                    </div>
                                    <p className="mt-6 text-sm text-slate-500 leading-relaxed">
                                        To update these settings, please modify the environment variables in your <code>docker-compose.prod.yml</code> file and restart the container.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "w-full flex items-center gap-4 px-5 py-4 rounded-xl transition-all font-medium",
                active
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            )}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode, label: string, value: string | number, color: string }) {
    const colors: Record<string, string> = {
        blue: "text-blue-500 bg-blue-500/10 border-blue-500/20",
        emerald: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
        purple: "text-purple-500 bg-purple-500/10 border-purple-500/20",
        orange: "text-orange-500 bg-orange-500/10 border-orange-500/20",
    };

    return (
        <div className="bg-[#0b1120] border border-slate-800 rounded-2xl p-6 shadow-sm">
            <div className={cn("w-12 h-12 rounded-xl border flex items-center justify-center mb-4 transition-transform hover:scale-110", colors[color])}>
                {icon}
            </div>
            <p className="text-slate-400 text-sm font-medium mb-1">{label}</p>
            <p className="text-2xl font-bold text-white">{value}</p>
        </div>
    );
}

function ContainerRow({ container, onBackup, progress, isSelected, onToggle }: {
    container: Container,
    onBackup: () => void,
    progress?: any,
    isSelected: boolean,
    onToggle: () => void
}) {
    const isRunning = container.State === 'running';
    const appType = detectApp(container);

    return (
        <div
            className={cn(
                "group bg-[#0b1120] border rounded-2xl p-6 transition-all hover:shadow-xl hover:shadow-black/20 flex items-center gap-6",
                isSelected ? "border-blue-500 bg-blue-500/5" : "border-slate-800 hover:border-slate-700"
            )}
        >
            <div
                className="w-6 h-6 rounded-md border border-slate-700 flex items-center justify-center cursor-pointer hover:border-blue-500 transition-colors"
                onClick={onToggle}
            >
                {isSelected && <div className="w-3 h-3 bg-blue-500 rounded-sm" />}
            </div>

            <div className="relative">
                <div className={cn(
                    "w-14 h-14 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105",
                    isRunning ? "bg-emerald-500/10 text-emerald-500" : "bg-slate-800 text-slate-500"
                )}>
                    {appType === 'database' ? <Database className="w-7 h-7" /> : <Box className="w-7 h-7" />}
                </div>
                <div className={cn(
                    "absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-4 border-[#0b1120]",
                    isRunning ? "bg-emerald-500" : "bg-slate-500"
                )} />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-lg font-bold text-white truncate max-w-[200px]">
                        {container.Names[0].replace('/', '')}
                    </h3>
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-400 max-w-[150px] truncate" title={container.Image}>
                        {container.Image}
                    </span>
                    {container.Labels['com.docker.compose.project'] && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-600/10 text-blue-400 text-[10px] font-bold uppercase tracking-wider border border-blue-600/20">
                            <Network className="w-2.5 h-2.5" />
                            Stack: {container.Labels['com.docker.compose.project']}
                        </div>
                    )}
                </div>
                <p className="text-sm text-slate-500 flex items-center gap-2">
                    <span className="capitalize">{container.State}</span>
                    <span className="w-1 h-1 rounded-full bg-slate-700" />
                    {container.Status}
                </p>
            </div>

            {progress && progress.status !== 'completed' && progress.status !== 'failed' ? (
                <div className="w-64">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2">
                            <RefreshCw className="w-3 h-3 animate-spin" /> {progress.status}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">STEP_TRANSITION</span>
                    </div>
                    <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 animate-[shimmer_2s_infinite]" style={{ width: '60%' }} />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 italic truncate">{progress.message}</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                        onClick={onBackup}
                        disabled={!isRunning}
                        className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold rounded-xl border border-slate-700 transition-all active:scale-95 disabled:opacity-30 flex items-center gap-2"
                    >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        Start Backup
                    </button>
                </div>
            )}
        </div>
    );
}

function detectApp(container: Container): 'database' | 'generic' {
    const dbImages = ['postgres', 'mysql', 'mariadb', 'redis', 'mongo'];
    if (dbImages.some(db => container.Image.toLowerCase().includes(db))) return 'database';
    return 'generic';
}
