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
    Activity,
    Layers,
    Terminal
} from 'lucide-react';
import {
    getContainers,
    triggerBackup,
    triggerStackBackup,
    triggerUnifiedStackBackup,
    getProgress,
    listBackups,
    restoreBackup,
    restoreUnifiedStackBackup,
    uploadBackup,
    restoreToNewContainer,
    getHistoryAction,
    getSettingsAction,
    saveSettingsAction,
    getStacksAction,
    importStackAction,
    deleteStackAction,
    type AppSettings,
    type HistoryEntry,
    type StackConfig
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
    const [activeTab, setActiveTab] = useState<'containers' | 'stacks' | 'history' | 'restore' | 'settings'>('containers');
    const [containers, setContainers] = useState<Container[]>(initialContainers);
    const [stacks, setStacks] = useState<Record<string, StackConfig>>({});
    const [backups, setBackups] = useState<BackupFile[]>([]);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [progress, setProgress] = useState<Record<string, any>>({});
    const [selectedContainers, setSelectedContainers] = useState<string[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);
    const [customPaths, setCustomPaths] = useState<Record<string, string>>({});
    const [showImportStack, setShowImportStack] = useState(false);
    const [yamlInput, setYamlInput] = useState('');
    const [stackNameInput, setStackNameInput] = useState(''); // Custom stack name
    const [envFileInput, setEnvFileInput] = useState(''); // Path to .env file

    // Filter containers based on search
    const filteredContainers = containers.filter(c =>
        c.Names[0].toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.Image.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const refreshData = async () => {
        setIsRefreshing(true);
        try {
            const [c, h, b, s, st] = await Promise.all([
                getContainers(),
                getHistoryAction(),
                listBackups(),
                getSettingsAction(),
                getStacksAction()
            ]);
            setContainers(c);
            setHistory(h);
            setBackups(b);
            setSettings(s);
            setStacks(st);
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
        const pathsMap: Record<string, string[]> = {};
        ids.forEach(id => {
            if (customPaths[id]) {
                pathsMap[id] = customPaths[id].split(',').map(p => p.trim()).filter(p => p !== '');
            }
        });

        const res = await triggerBackup(ids, pathsMap);
        if (res.success) {
            setSelectedContainers([]);
            alert(`Started backup for ${res.count} containers`);
        }
    };

    const handleRestore = async (file: string, containerId: string) => {
        if (!confirm(`Are you sure you want to restore ${file} into ${containerId}? DATA MAY BE OVERWRITTEN.`)) return;

        setIsRestoring(true);
        try {
            const res = await restoreBackup(file, containerId);
            if (res?.success) {
                alert('Restore completed successfully');
                refreshData();
            } else {
                alert(`Restore failed: ${(res as any)?.error || 'Unknown error'}`);
            }
        } catch (err: any) {
            alert(`Restore error: ${err.message}`);
        } finally {
            setIsRestoring(false);
        }
    };

    const handleSmartRestore = async (file: string) => {
        // DETECT STACK BACKUP
        if (file.startsWith('stack_') || file.includes('stack_metadata.json')) {
            // It's a Unified Stack Backup - auto-deploy and restore
            if (!confirm(`📦 Restore Stack Backup\n\nFile: ${file}\n\nThis will:\n1. Deploy the stack from backup's docker-compose.yml\n2. Restore all data (databases + volumes)\n\nProceed?`)) return;

            const jobId = `restore-stack-${Date.now()}`;
            setProgress(prev => ({ ...prev, [jobId]: { status: 'processing', message: 'Initializing Stack Restore...' } }));
            setIsRestoring(true);

            try {
                const res = await restoreUnifiedStackBackup(file);
                if (res.success) {
                    alert(res.message || 'Stack Restore completed successfully');
                    refreshData();
                } else {
                    alert(`Stack Restore failed: ${res.error}`);
                }
            } catch (err: any) {
                alert(`Execution error: ${err.message}`);
            } finally {
                setIsRestoring(false);
            }
            return;
        }

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

    const handleImportStack = async () => {
        if (!yamlInput.trim()) return;

        // Parse environment variables from textarea
        let envVars: Record<string, string> | undefined;
        if (envFileInput.trim()) {
            envVars = {};
            envFileInput.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (trimmed && trimmed.includes('=')) {
                    const [key, ...valueParts] = trimmed.split('=');
                    envVars![key.trim()] = valueParts.join('=').trim();
                }
            });
        }

        const res = await importStackAction(yamlInput, stackNameInput.trim() || undefined, envVars);
        if (res.success) {
            setYamlInput('');
            setStackNameInput('');
            setEnvFileInput('');
            setShowImportStack(false);
            refreshData();
            alert(`Imported stack: ${res.name}`);
        } else {
            alert(`Error: ${res.error}`);
        }
    };

    const handleDeleteStack = async (name: string) => {
        if (confirm(`Are you sure you want to delete stack "${name}" configuration?`)) {
            await deleteStackAction(name);
            const updated = await getStacksAction();
            setStacks(updated);
        }
    };

    const handleStackBackup = async (name: string) => {
        const res = await triggerUnifiedStackBackup(name);
        if (res.success) {
            const updatedProgress = await getProgress();
            setProgress(updatedProgress);
        } else {
            alert(`Failed: ${res.error}`);
        }
    };

    return (
        <div className="flex h-screen bg-[#020617] text-slate-200 overflow-hidden font-sans">
            {/* REAL-TIME PROGRESS MODAL */}
            {Object.keys(progress).length > 0 && (
                <div className="fixed bottom-4 right-4 z-50 max-w-md w-full">
                    <div className="bg-slate-900 rounded-lg shadow-2xl border border-slate-700 overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-white font-semibold">
                                {Object.values(progress).some((job: any) => job.status === 'processing') && (
                                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                )}
                                {!Object.values(progress).some((job: any) => job.status === 'processing') && (
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                )}
                                <span>Active Tasks ({Object.keys(progress).length})</span>
                            </div>
                            <button
                                onClick={() => setProgress({})}
                                className="text-white hover:text-gray-200 transition-colors"
                                title="Clear completed tasks"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                            {Object.entries(progress).map(([jobId, job]: [string, any]) => (
                                <div
                                    key={jobId}
                                    className={cn(
                                        "px-4 py-3 border-b border-slate-700 last:border-0",
                                        job.status === 'completed' && "bg-green-900/20",
                                        job.status === 'failed' && "bg-red-900/20",
                                        job.status === 'processing' && "bg-blue-900/20"
                                    )}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="flex-shrink-0 mt-1">
                                            {job.status === 'processing' && (
                                                <svg className="animate-spin h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                            )}
                                            {job.status === 'completed' && (
                                                <svg className="h-5 w-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                            {job.status === 'failed' && (
                                                <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-white truncate">
                                                {jobId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                            </p>
                                            <p className="text-sm text-slate-400 mt-1 whitespace-pre-wrap">
                                                {job.message}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

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
                        icon={<Layers className="w-5 h-5" />}
                        label="Stacks"
                        active={activeTab === 'stacks'}
                        onClick={() => setActiveTab('stacks')}
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
                        {/* Global Active Tasks Monitor */}
                        {Object.entries(progress).filter(([k, v]) => k.startsWith('stack-') && v.status === 'processing').length > 0 && (
                            <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl p-6 mb-6">
                                <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Layers className="w-4 h-4" /> Global Active Tasks
                                </h3>
                                <div className="space-y-4">
                                    {Object.entries(progress)
                                        .filter(([k, v]) => k.startsWith('stack-') && v.status === 'processing')
                                        .map(([id, p]) => (
                                            <div key={id} className="bg-[#0b1120] border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-lg">
                                                <div className="flex items-center gap-4">
                                                    <div className="p-2 bg-blue-600/10 rounded-lg">
                                                        <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-white text-sm">{id.replace('stack-', 'Stack: ')}</p>
                                                        <p className="text-xs text-slate-400">{p.message}</p>
                                                    </div>
                                                </div>
                                                <div className="w-48">
                                                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-blue-500 transition-all duration-500"
                                                            style={{ width: `${p.progress || 0}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )}

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
                                            onToggle={() => setSelectedContainers(prev =>
                                                prev.includes(container.Id) ? prev.filter(i => i !== container.Id) : [...prev, container.Id]
                                            )}
                                            customPath={customPaths[container.Id] || ''}
                                            onCustomPathChange={(val) => setCustomPaths(prev => ({ ...prev, [container.Id]: val }))}
                                            stackName={container.Labels?.['com.docker.compose.project']}
                                            hasStackConfig={!!stacks[container.Labels?.['com.docker.compose.project'] || '']}
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

                        {activeTab === 'stacks' && (
                            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-blue-600/10 rounded-2xl border border-blue-500/20">
                                            <Layers className="w-6 h-6 text-blue-500" />
                                        </div>
                                        <div>
                                            <h2 className="text-3xl font-bold text-white tracking-tight">Stacks Manager</h2>
                                            <p className="text-slate-500 font-medium">Map Portainer/Compose YAML to enhance backup accuracy.</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setShowImportStack(true)}
                                        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95 flex items-center gap-2"
                                    >
                                        <Plus className="w-5 h-5" /> Import Stack
                                    </button>
                                </div>

                                <div className="grid gap-6">
                                    {Object.values(stacks).length === 0 ? (
                                        <div className="bg-[#0b1120] border border-slate-800/50 rounded-3xl p-16 text-center">
                                            <div className="w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center mx-auto mb-6 border border-slate-800">
                                                <Layers className="w-10 h-10 text-slate-700" />
                                            </div>
                                            <h3 className="text-xl font-bold text-white mb-2">No stacks imported</h3>
                                            <p className="text-slate-500 max-w-md mx-auto mb-8">Paste your docker-compose.yml files here to help us identify exact volume paths for containers.</p>
                                            <button
                                                onClick={() => setShowImportStack(true)}
                                                className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all border border-slate-700 font-bold"
                                            >
                                                Import your first stack
                                            </button>
                                        </div>
                                    ) : (
                                        Object.values(stacks).map((stack) => (
                                            <div key={stack.name} className="bg-[#0b1120] border border-slate-800/50 rounded-3xl p-8 hover:border-slate-700 transition-all group">
                                                <div className="flex items-center justify-between mb-6">
                                                    <div className="flex items-center gap-4">
                                                        <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                                                            <Box className="w-5 h-5 text-blue-400" />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-lg font-bold text-white">{stack.name}</h3>
                                                            <p className="text-xs text-slate-500">{Object.keys(stack.services).length} Services identified</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            onClick={() => handleStackBackup(stack.name)}
                                                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white text-xs font-bold rounded-lg border border-blue-500/20 transition-all active:scale-95 group/btn"
                                                            title="Backup All Containers in Stack"
                                                        >
                                                            <Play className="w-3.5 h-3.5 fill-current group-hover/btn:fill-white" />
                                                            Backup All
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setYamlInput(stack.yaml);
                                                                setShowImportStack(true);
                                                            }}
                                                            className="p-2 text-slate-500 hover:text-white transition-colors"
                                                            title="Edit YAML"
                                                        >
                                                            <Terminal className="w-5 h-5" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteStack(stack.name)}
                                                            className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                                                            title="Delete"
                                                        >
                                                            <Trash2 className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-4 gap-4">
                                                    {Object.values(stack.services).map(s => (
                                                        <div key={s.name} className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4">
                                                            <div className="font-bold text-slate-300 text-xs mb-1 truncate">{s.name}</div>
                                                            <div className="text-[10px] text-slate-500 truncate">{s.image}</div>
                                                            <div className="mt-2 flex gap-1">
                                                                {s.volumes.length > 0 ? (
                                                                    <span className="text-[10px] bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded border border-blue-500/20">
                                                                        {s.volumes.length} Volumes
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[10px] bg-orange-500/10 text-orange-500 px-1.5 py-0.5 rounded border border-orange-500/20">
                                                                        No Volumes
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Import Modal */}
                {showImportStack && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowImportStack(false)} />
                        <div className="relative bg-[#0b1120] border border-slate-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                            <div className="p-8 border-b border-slate-800/50 flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-bold text-white">Import Portainer/Compose Stack</h3>
                                    <p className="text-sm text-slate-500">Paste your docker-compose.yml below to enhance backup detection.</p>
                                </div>
                                <button onClick={() => setShowImportStack(false)} className="text-slate-500 hover:text-white">
                                    <XCircle className="w-6 h-6" />
                                </button>
                            </div>
                            <div className="p-8 space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-white mb-2">
                                        Stack Name
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-700"
                                        placeholder="e.g. my-app-production (optional)"
                                        value={stackNameInput}
                                        onChange={(e) => setStackNameInput(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-white mb-2">
                                        Compose YAML
                                    </label>
                                    <textarea
                                        className="w-full h-80 bg-slate-950 border border-slate-800 rounded-2xl p-6 font-mono text-sm text-blue-300 focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-700"
                                        placeholder="version: '3.8'&#10;services:&#10;  app:&#10;    image: custom-image&#10;    volumes:&#10;      - ./data:/app/data"
                                        value={yamlInput}
                                        onChange={(e) => setYamlInput(e.target.value)}
                                    />
                                </div>

                                <div className="mt-6">
                                    <label className="block text-sm font-semibold text-white mb-2">
                                        Environment Variables (Optional)
                                    </label>
                                    <p className="text-xs text-slate-500 mb-3">
                                        Paste your Portainer environment variables here (one per line: KEY=value)
                                    </p>
                                    <textarea
                                        className="w-full h-40 bg-slate-950 border border-slate-800 rounded-2xl p-6 font-mono text-sm text-emerald-300 focus:ring-2 focus:ring-emerald-500 outline-none transition-all placeholder:text-slate-700"
                                        placeholder="DB_PASSWORD=secret123&#10;ADMIN_SECRET=xyz&#10;SMTP_HOST=smtp.example.com"
                                        value={envFileInput}
                                        onChange={(e) => setEnvFileInput(e.target.value)}
                                    />
                                </div>
                                <div className="mt-8 flex justify-end gap-4">
                                    <button
                                        onClick={() => setShowImportStack(false)}
                                        className="px-6 py-3 text-slate-400 font-bold hover:text-slate-200"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleImportStack}
                                        className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95"
                                    >
                                        Save Stack Configuration
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div >
                )
                }
            </main >
        </div >
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

function ContainerRow({ container, onBackup, progress, isSelected, onToggle, customPath, onCustomPathChange, stackName, hasStackConfig }: {
    container: Container,
    onBackup: () => void,
    progress?: any,
    isSelected: boolean,
    onToggle: () => void,
    customPath: string,
    onCustomPathChange: (val: string) => void,
    stackName?: string,
    hasStackConfig: boolean
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
                className={cn(
                    "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all cursor-pointer",
                    isSelected ? "bg-blue-600 border-blue-600 shadow-lg shadow-blue-500/30" : "border-slate-800 group-hover:border-slate-700"
                )}
                onClick={onToggle}
            >
                {isSelected && <CheckCircle2 className="w-4 h-4 text-white" />}
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
                    {stackName && (
                        <div className={cn(
                            "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                            hasStackConfig ? "bg-blue-600/10 text-blue-400 border-blue-600/20" : "bg-slate-900 text-slate-500 border-slate-800"
                        )}>
                            <Layers className="w-2.5 h-2.5" />
                            {hasStackConfig ? `Stack: ${stackName}` : `Compose: ${stackName}`}
                        </div>
                    )}
                </div>
                <p className="text-sm text-slate-500 flex items-center gap-2">
                    <span className="capitalize">{container.State}</span>
                    <span className="w-1 h-1 rounded-full bg-slate-700" />
                    {container.Status}
                </p>
            </div>

            {progress && (progress.status === 'processing' || progress.status === 'queued') ? (
                <div className="w-64">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2">
                            <RefreshCw className="w-3" /> {progress.status}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                            {progress.progress || 0}%
                        </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-blue-500 transition-all duration-500"
                            style={{ width: `${progress.progress || 0}%` }}
                        />
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-4">
                    <div className="relative group/custom">
                        <input
                            type="text"
                            placeholder="Custom paths..."
                            value={customPath}
                            onChange={(e) => onCustomPathChange(e.target.value)}
                            className="bg-slate-900/50 border border-slate-700/50 rounded-lg py-1.5 px-3 text-[10px] text-slate-300 w-32 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600 focus:w-48"
                        />
                        {isRunning && appType === 'generic' && !customPath && !hasStackConfig && (
                            <div className="absolute -left-6 top-2 group/warn">
                                <AlertCircle className="w-4 h-4 text-slate-500/50" />
                                <div className="absolute bottom-full left-0 mb-2 w-48 p-2 bg-slate-800 text-[10px] text-slate-300 rounded shadow-2xl opacity-0 invisible group-hover/warn:opacity-100 group-hover/warn:visible transition-all z-30 pointer-events-none border border-slate-700">
                                    No paths configured. Only <b>config.json</b> will be backed up.
                                </div>
                            </div>
                        )}
                        {hasStackConfig && (
                            <div className="absolute -left-6 top-2 group/info">
                                <CheckCircle2 className="w-4 h-4 text-blue-500/50" />
                                <div className="absolute bottom-full left-0 mb-2 w-48 p-2 bg-slate-800 text-[10px] text-slate-300 rounded shadow-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-30 pointer-events-none border border-slate-700">
                                    Using paths from <b>Stack YAML</b>.
                                </div>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onBackup}
                        disabled={!isRunning}
                        className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold rounded-xl border border-slate-700 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-2"
                    >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        Backup
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
