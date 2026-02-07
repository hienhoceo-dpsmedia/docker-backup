'use server';

import docker from '@/lib/docker';
import { backupQueue, updateJobStatus, getAllJobs } from '@/lib/queue';
import { addHistoryEntry, getHistory, getSettings, saveSettings, AppSettings, HistoryEntry } from '@/lib/storage'; // Added imports

// Re-export types for client components (without node:fs)
export type { AppSettings, HistoryEntry } from '@/lib/storage';
import fs from 'node:fs';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import archiver from 'archiver'; // Installed dependency
import AdmZip from 'adm-zip'; // Installed for restore

// Helper to check if Rclone is configured (Mock for MVP)
const hasRclone = false; // Set to true if Rclone is configured

// Server action wrappers for storage (to avoid client-side node:fs imports)
export async function getHistoryAction() {
    return getHistory();
}

export async function getSettingsAction() {
    return getSettings();
}

export async function saveSettingsAction(settings: AppSettings) {
    return saveSettings(settings);
}

export async function getContainers() {
    try {
        const containers = await docker.listContainers({ all: true });
        return containers.map(c => ({
            Id: c.Id,
            Names: c.Names,
            Image: c.Image,
            State: c.State,
            Status: c.Status,
            Labels: c.Labels
        }));
    } catch (error) {
        console.error("Docker Error:", error);
        return [];
    }
}

export async function getProgress() {
    return getAllJobs();
}

export async function triggerBackup(containerIds: string[], customPathsMap?: Record<string, string[]>) {
    // Add all to queue
    for (const id of containerIds) {
        updateJobStatus(id, 'pending', 'Queued');

        const customPaths = customPathsMap?.[id];
        backupQueue.add(async () => {
            await processBackup(id, customPaths);
        });
    }
    revalidatePath('/');
    return { success: true, count: containerIds.length };
}

// The Worker Function
async function processBackup(containerId: string, customPaths?: string[]) {
    try {
        updateJobStatus(containerId, 'processing', 'Identifying...');
        const backupDir = path.join(process.cwd(), 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        // Generate the backup file
        const filePath = await generateBackupFile(containerId, backupDir, customPaths);

        // Handle Upload
        await handleUpload(containerId, filePath);

    } catch (error: any) {
        console.error(`Backup failed for ${containerId}:`, error);
        updateJobStatus(containerId, 'failed', error.message);
        addHistoryEntry({
            id: Date.now().toString(),
            date: new Date().toISOString(),
            containerName: 'Unknown',
            status: 'failed',
            destination: 'local',
            message: error.message
        });
    }
}

// App-specific backup paths configuration
const APP_BACKUP_PATHS: Record<string, string[]> = {
    'n8n': ['/home/node/.n8n', '/home/node/.n8n/binaryData'],
    'wordpress': ['/var/www/html', '/var/www/html/wp-content'],
    'metabase': ['/metabase-data'],
    'nocodb': ['/usr/app/data'],
    'baserow': ['/baserow/data'],
    'redis': ['/data'],
    'portainer': ['/data'],
    'nginx-proxy-manager': ['/data', '/etc/letsencrypt'],
    'imgproxy': ['/var/lib/storage'],
};

// Helper: Detect app type from Docker image/labels
function detectAppType(image: string, labels: Record<string, string> = {}): string {
    const patterns: [string, string][] = [
        ['n8n', 'n8n'],
        ['metabase', 'metabase'],
        ['nocodb', 'nocodb'],
        ['baserow', 'baserow'],
        ['postgres', 'postgres'],
        ['timescale', 'postgres'],
        ['mysql', 'mysql'],
        ['mariadb', 'mysql'],
        ['redis', 'redis'],
        ['wordpress', 'wordpress'],
        ['portainer', 'portainer'],
        ['nginx-proxy-manager', 'nginx-proxy-manager'],
        ['imgproxy', 'imgproxy'],
        ['ghost', 'ghost'],
        ['uptime-kuma', 'uptime-kuma'],
        ['activepieces', 'activepieces'],
        ['supabase', 'supabase'],
        ['rabbitmq', 'rabbitmq'],
        ['mongodb', 'mongodb'],
    ];

    // Check labels first (more precise)
    const serviceName = labels['com.docker.compose.service'] || labels['org.opencontainers.image.title'];
    if (serviceName) {
        for (const [pattern, type] of patterns) {
            if (serviceName.toLowerCase().includes(pattern)) return type;
        }
    }

    // Fallback to image name
    for (const [pattern, type] of patterns) {
        if (image.toLowerCase().includes(pattern)) return type;
    }
    return 'generic';
}

// Helper: Generates the backup artifact (Zip) on disk
async function generateBackupFile(containerId: string, backupDir: string, customPaths?: string[]): Promise<string> {
    updateJobStatus(containerId, 'processing', 'Step: Inspecting Container...');
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const image = info.Config.Image;
    const name = info.Name.replace('/', '');

    let ext = 'zip';
    let filePath = path.join(backupDir, `${name}_${Date.now()}.zip`);

    if (image.includes('postgres') || image.includes('timescale') || image.includes('mysql') || image.includes('mariadb')) {
        updateJobStatus(containerId, 'processing', 'Step: DB Strategy Detected');
        // STRATEGY 1: DATABASE DUMP (ZIP WRAPPED)
        const tempSqlPath = path.join(backupDir, `temp_${name}_${Date.now()}.sql`);
        let cmd: string[] = [];

        const getEnv = (key: string) => {
            const envStr = info.Config.Env?.find((e: string) => e.startsWith(`${key}=`));
            if (!envStr) return null;
            return envStr.split('=').slice(1).join('='); // Handle values with '='
        };

        if (image.includes('postgres') || image.includes('timescale')) {
            updateJobStatus(containerId, 'processing', 'Step: Config Postgres Dump');
            // STRATEGY: Explicitly inject credentials into the command string
            // This bypasses potential lack of environment inheritance in 'docker exec'
            const pgUser = getEnv('POSTGRES_USER') || 'postgres';
            const pgPwd = getEnv('POSTGRES_PASSWORD') || getEnv('POSTGRES_PASS'); // Handle both conventions

            // Construct command with escaped values
            if (pgPwd) {
                // Use sh -c to safely handle inline password
                cmd = ['sh', '-c', `PGPASSWORD='${pgPwd.replace(/'/g, "'\\''")}' pg_dumpall -U '${pgUser}' -w --clean --if-exists`];
            } else {
                // No password found, try standard (might fail if password required)
                cmd = ['sh', '-c', `pg_dumpall -U '${pgUser}' -w --clean --if-exists`];
            }
            console.log(`[Backup] Postgres CMD for ${name}:`, cmd[2].replace(/PGPASSWORD='.*?'/, "PGPASSWORD='***'"));
        } else {
            updateJobStatus(containerId, 'processing', 'Step: Config MySQL Dump');
            const mysqlPwd = getEnv('MYSQL_ROOT_PASSWORD');
            if (mysqlPwd) {
                cmd = ['sh', '-c', `mysqldump -u root -p"${mysqlPwd}" --all-databases`];
            } else {
                cmd = ['sh', '-c', 'mysqldump -u root --all-databases --skip-lock-tables'];
            }
        }

        updateJobStatus(containerId, 'processing', 'Step: Executing Dump Command...');

        const exec = await container.exec({
            Cmd: cmd,
            AttachStdout: true,
            AttachStderr: true
        });
        await new Promise<void>((resolve, reject) => {
            // Safety Timeout 5 minutes
            const timeout = setTimeout(() => {
                reject(new Error("Backup timed out after 300 seconds. Check container logs."));
            }, 300000);

            exec.start({}, (err: any, stream: any) => {
                if (err) { clearTimeout(timeout); return reject(err); }

                const fileStream = fs.createWriteStream(tempSqlPath);

                // Capture Stderr for debugging
                let stderrData = '';
                const { Writable } = require('stream');
                const stderrStream = new Writable({
                    write(chunk: any, encoding: any, callback: any) {
                        stderrData += chunk.toString();
                        process.stderr.write(chunk);
                        callback();
                    }
                });

                container.modem.demuxStream(stream, fileStream, stderrStream);

                stream.on('end', () => fileStream.end());
                fileStream.on('finish', () => {
                    clearTimeout(timeout);
                    try {
                        const stats = fs.statSync(tempSqlPath);
                        if (stats.size === 0) {
                            reject(new Error(`Empty SQL Dump. Stderr: ${stderrData || 'None'}`));
                        }
                        else resolve();
                    } catch (e) { reject(e); }
                });
                fileStream.on('error', (e: any) => { clearTimeout(timeout); reject(e); });
                stream.on('error', (e: any) => { clearTimeout(timeout); reject(e); });
            });
        });

        updateJobStatus(containerId, 'processing', 'Step: Compressing SQL...');
        const output = fs.createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        await new Promise<void>((resolve, reject) => {
            // Safety Timeout 5 minutes for Compression Phase
            const timeout = setTimeout(() => {
                reject(new Error("Compression timed out after 300 seconds."));
            }, 300000);

            output.on('close', () => { clearTimeout(timeout); resolve(); });
            output.on('finish', () => { clearTimeout(timeout); resolve(); }); // Listen to finish too

            archive.on('error', (err: any) => { clearTimeout(timeout); reject(err); });
            archive.pipe(output);

            const configData = {
                name: info.Name,
                image: info.Config.Image,
                env: info.Config.Env,
                ports: info.Config.ExposedPorts,
                cmd: info.Config.Cmd,
                networkSettings: info.NetworkSettings,
                backupType: 'database',
                timestamp: new Date().toISOString()
            };
            archive.append(JSON.stringify(configData, null, 2), { name: 'config.json' });

            // Log file size
            try {
                const stats = fs.statSync(tempSqlPath);
                updateJobStatus(containerId, 'processing', `Step: Compressing SQL (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);

                // Use Buffer instead of Stream to avoid potential file locking/stream hanging
                const sqlBuffer = fs.readFileSync(tempSqlPath);
                archive.append(sqlBuffer, { name: 'dump.sql' });
            } catch (e: any) {
                console.error("Buffer error:", e);
                archive.append(Buffer.from(`Error reading dump: ${e.message}`), { name: 'dump_error.txt' });
            }

            updateJobStatus(containerId, 'processing', 'Step: Finalizing Zip...');

            archive.finalize().catch((err: any) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        if (fs.existsSync(tempSqlPath)) fs.unlinkSync(tempSqlPath);
        return filePath;

    } else {
        // STRATEGY 2: VOLUME BACKUP
        updateJobStatus(containerId, 'processing', 'Step: Volume Strategy Detected');

        const mounts = info.Mounts || [];
        const declaredVolumes = info.Config.Volumes ? Object.keys(info.Config.Volumes) : [];
        const pathsToBackup = new Set<string>();
        mounts.forEach((m: any) => pathsToBackup.add(m.Destination));
        declaredVolumes.forEach((v: string) => pathsToBackup.add(v));

        // Add app-specific fallback paths from config
        for (const [appKey, paths] of Object.entries(APP_BACKUP_PATHS)) {
            if (image.includes(appKey)) {
                paths.forEach(p => pathsToBackup.add(p));
            }
        }

        // Add custom paths if provided
        if (customPaths && customPaths.length > 0) {
            customPaths.forEach(p => {
                if (p.trim()) pathsToBackup.add(p.trim());
            });
        }

        // SMART FALLBACK: If still empty, use WorkingDir
        if (pathsToBackup.size === 0 && info.Config.WorkingDir) {
            console.log(`[Backup] No volumes found for ${name}. Falling back to WorkingDir: ${info.Config.WorkingDir}`);
            pathsToBackup.add(info.Config.WorkingDir);
        } else if (pathsToBackup.size === 0) {
            // Extreme fallback if even WorkingDir is empty
            pathsToBackup.add('/app');
        }

        const uniquePaths = Array.from(pathsToBackup);
        updateJobStatus(containerId, 'processing', `Step: Archiving ${uniquePaths.length} Volumes...`);
        console.log(`[Backup] Volume Strategy for ${name}. Paths:`, uniquePaths);

        const output = fs.createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        await new Promise<void>(async (resolve, reject) => {
            // Safety Timeout 5 minutes for Volume Phase
            const timeout = setTimeout(() => {
                reject(new Error("Volume Backup timed out after 300 seconds."));
            }, 300000);

            output.on('close', () => {
                clearTimeout(timeout);
                resolve();
            });
            archive.on('error', (err: any) => {
                clearTimeout(timeout);
                reject(err);
            });
            archive.pipe(output);

            const configData = {
                name: info.Name,
                image: info.Config.Image,
                env: info.Config.Env,
                ports: info.Config.ExposedPorts,
                hostConfig: info.HostConfig, // Added to preserve port bindings and other settings
                cmd: info.Config.Cmd,
                networkSettings: info.NetworkSettings,
                appType: detectAppType(image, info.Config.Labels),
                backupPaths: uniquePaths,
                // Compose labels for stack restore
                composeProject: info.Config.Labels?.['com.docker.compose.project'] || null,
                composeService: info.Config.Labels?.['com.docker.compose.service'] || null,
                timestamp: new Date().toISOString()
            };
            archive.append(JSON.stringify(configData, null, 2), { name: 'config.json' });

            for (const volPath of uniquePaths) {
                try {
                    updateJobStatus(containerId, 'processing', `Step: Archiving ${volPath}`);
                    console.log(`[Backup] Archiving volume: ${volPath}`);
                    const tarStream = await container.getArchive({ path: volPath });
                    const safeName = volPath.replace(/[\/\\]/g, '_').replace(/^_/, '') + '.tar';
                    archive.append(tarStream as any, { name: safeName });
                } catch (err: any) {
                    console.error(`[Backup] Failed to archive volume ${volPath}:`, err);
                    archive.append(`Failed: ${err.message}`, { name: `ERROR_${volPath.replace(/[\/\\]/g, '_')}.txt` });
                }
            }
            await archive.finalize();
        });
        updateJobStatus(containerId, 'processing', 'Step: Archive Finalized');
        return filePath;
    }
}

// Helper: Handles Upload to Telegram/Local
async function handleUpload(containerId: string, filePath: string) {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
    const TELEGRAM_API_ROOT = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
    const CHAT_ID = process.env.CHAT_ID;
    // Mock ID if not provided (for stack backups where containerId might be virtual)
    const name = path.basename(filePath);

    if (TELEGRAM_TOKEN && CHAT_ID) {
        updateJobStatus(containerId, 'uploading', 'Sending to Telegram...');
        try {
            const fileStats = fs.statSync(filePath);
            const fileSize = (fileStats.size / 1024 / 1024).toFixed(2) + ' MB';
            const fileBuffer = fs.readFileSync(filePath);
            const formData = new FormData();
            formData.append('chat_id', CHAT_ID);
            const blob = new Blob([fileBuffer]);
            formData.append('document', blob, name);

            const res = await fetch(`${TELEGRAM_API_ROOT}/bot${TELEGRAM_TOKEN}/sendDocument`, {
                method: 'POST',
                body: formData
            });

            if (!res.ok) throw new Error(`Telegram Upload Failed: ${res.status} ${await res.text()}`);

            fs.unlinkSync(filePath);
            updateJobStatus(containerId, 'completed', 'Sent to Telegram & Cleaned');
            addHistoryEntry({
                id: Date.now().toString(),
                date: new Date().toISOString(),
                containerName: name, // simplified
                status: 'success',
                destination: 'telegram',
                message: `Backup sent to Telegram`,
                size: fileSize
            });

        } catch (uploadErr: any) {
            console.error("Telegram Error:", uploadErr);
            updateJobStatus(containerId, 'completed', 'Saved Local (Telegram Failed)');
            addHistoryEntry({
                id: Date.now().toString(),
                date: new Date().toISOString(),
                containerName: name,
                status: 'failed',
                destination: 'local',
                message: `Telegram upload failed: ${uploadErr.message}`
            });
        }
    } else {
        updateJobStatus(containerId, 'completed', 'Saved to local disk');
        const stats = fs.statSync(filePath);
        addHistoryEntry({
            id: Date.now().toString(),
            date: new Date().toISOString(),
            containerName: name,
            status: 'success',
            destination: 'local',
            message: 'Saved to local disk',
            size: (stats.size / 1024 / 1024).toFixed(2) + ' MB'
        });
    }
}

// Restore Logic
export async function listBackups() {
    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) return [];

    const files = fs.readdirSync(backupDir);
    return files
        .filter(f => f.endsWith('.sql') || f.endsWith('.sql.gz') || f.endsWith('.zip'))
        .map(f => {
            const stats = fs.statSync(path.join(backupDir, f));
            return {
                id: f,
                name: f,
                size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                date: stats.mtime.toISOString()
            };
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function restoreBackup(filename: string, containerId: string) {
    try {
        updateJobStatus(containerId, 'processing', 'Restoring...');

        const backupDir = path.join(process.cwd(), 'backups');
        const filePath = path.join(backupDir, filename);
        if (!fs.existsSync(filePath)) throw new Error('Backup file not found');

        const container = docker.getContainer(containerId);
        const info = await container.inspect();
        const image = info.Config.Image;

        let cmd: string[] = [];

        // Construct Restore Command
        // Note: This is complex because we need to pipe the file INTO the exec process.
        // Dockerode exec is usually for running a command. piping input requires stream handling.

        if (image.includes('postgres') || image.includes('timescale')) {
            // Postgres restore: psql -U postgres < file.sql
            cmd = ['psql', '-U', 'postgres'];
            const fileStream = fs.createReadStream(filePath);
            const exec = await container.exec({
                Cmd: cmd,
                AttachStdin: true,
                AttachStdout: true,
                AttachStderr: true,
                Tty: false
            });
            await new Promise<void>((resolve, reject) => {
                // Safety timeout for restore (5 minutes)
                const timeout = setTimeout(() => {
                    reject(new Error("SQL restore timed out after 300 seconds"));
                }, 300000);

                exec.start({ hijack: true, stdin: true }, (err: any, stream: any) => {
                    if (err) { clearTimeout(timeout); return reject(err); }

                    let resolved = false;
                    const doResolve = () => {
                        if (resolved) return;
                        resolved = true;
                        clearTimeout(timeout);
                        resolve();
                    };

                    fileStream.pipe(stream);
                    stream.on('end', doResolve);
                    stream.on('close', doResolve);
                    stream.on('error', (e: any) => { clearTimeout(timeout); reject(e); });
                    fileStream.on('end', () => {
                        setTimeout(() => { stream.end(); doResolve(); }, 1000);
                    });
                    fileStream.on('error', (e: any) => { clearTimeout(timeout); reject(e); });
                });
            });
        } else if (image.includes('mysql') || image.includes('mariadb')) {
            // MySQL restore: mysql -u root -p"..." < file.sql
            cmd = ['sh', '-c', 'mysql -u root -p"$MYSQL_ROOT_PASSWORD"'];
            const fileStream = fs.createReadStream(filePath);
            const exec = await container.exec({
                Cmd: cmd,
                AttachStdin: true,
                AttachStdout: true,
                AttachStderr: true,
                Tty: false
            });
            await new Promise<void>((resolve, reject) => {
                // Safety timeout for restore (5 minutes)
                const timeout = setTimeout(() => {
                    reject(new Error("SQL restore timed out after 300 seconds"));
                }, 300000);

                exec.start({ hijack: true, stdin: true }, (err: any, stream: any) => {
                    if (err) { clearTimeout(timeout); return reject(err); }

                    let resolved = false;
                    const doResolve = () => {
                        if (resolved) return;
                        resolved = true;
                        clearTimeout(timeout);
                        resolve();
                    };

                    fileStream.pipe(stream);
                    stream.on('end', doResolve);
                    stream.on('close', doResolve);
                    stream.on('error', (e: any) => { clearTimeout(timeout); reject(e); });
                    fileStream.on('end', () => {
                        setTimeout(() => { stream.end(); doResolve(); }, 1000);
                    });
                    fileStream.on('error', (e: any) => { clearTimeout(timeout); reject(e); });
                });
            });
        } else if (filename.endsWith('.zip')) {
            // STRATEGY 2: RESTORE FROM ZIP (SMART VOLUME RESTORE)
            updateJobStatus(containerId, 'processing', 'Extracting Backup...');

            const zip = new AdmZip(filePath);
            const zipEntries = zip.getEntries();

            // 1. Find config.json
            const configEntry = zipEntries.find(entry => entry.entryName === 'config.json');
            if (configEntry) {
                const config = JSON.parse(configEntry.getData().toString('utf8'));
                console.log(`[Restore] Restoring ${config.name} from ${config.timestamp}`);
                // Potential TODO: Check if container Env matches config Env and warn user?
            }

            // 2. Initial cleanup? (Optional, risky)
            // 3. Restore Volumes
            for (const entry of zipEntries) {
                if (entry.entryName.endsWith('.tar')) {
                    // entryName is like: _home_node_.n8n.tar
                    // We need to reconstruct the Original Path, OR just rely on the heuristic
                    // But wait, getArchive produces a tar of the directory content.
                    // If we downloaded `/home/node/.n8n`, the tar contains `.n8n/`.
                    // To restore it to `/home/node/.n8n`, we should put it to `/home/node`.

                    // Let's try to parse the original path from filename? 
                    // No, config.json is safer if we had it mapped. 
                    // But for now let's rely on the filename: _home_node_.n8n.tar -> /home/node/.n8n
                    let originalPath = entry.entryName.replace(/_/g, '/').replace('.tar', '');
                    // Fix unexpected leading slash issues or double slashed
                    if (!originalPath.startsWith('/')) originalPath = '/' + originalPath;

                    // Correct logic: `putArchive` expects the tar stream. 
                    // If the tar contains the folder itself (e.g. `.n8n/`), we need to put it in the PARENT directory.
                    const parentDir = path.dirname(originalPath);

                    console.log(`[Restore] Putting volume ${entry.entryName} to ${parentDir}`);
                    updateJobStatus(containerId, 'processing', `Restoring ${originalPath}...`);

                    const buffer = entry.getData(); // Get buffer (sync)

                    try {
                        await container.putArchive(buffer, { path: parentDir });
                    } catch (err: any) {
                        console.error(`[Restore] Failed to put archive: ${err.message}`);
                        throw new Error(`Failed to restore volume ${originalPath}: ${err.message}`);
                    }
                }
            }

        } else {
            throw new Error('Unsupported container type or file format for auto-restore');
        }

        updateJobStatus(containerId, 'completed', 'Restored Successfully');

        addHistoryEntry({
            id: Date.now().toString(),
            date: new Date().toISOString(),
            containerName: info.Name?.replace('/', ''),
            status: 'success',
            destination: 'local',
            message: `Restored from ${filename}`,
        });

        return { success: true };

    } catch (error: any) {
        console.error("Restore failed:", error);
        updateJobStatus(containerId, 'failed', `Restore Error: ${error.message}`);
        addHistoryEntry({
            id: Date.now().toString(),
            date: new Date().toISOString(),
            containerName: containerId,
            status: 'failed',
            destination: 'local',
            message: `Restore failed: ${error.message}`,
        });
        return { success: false, error: error.message };
    }
}



export async function uploadBackup(formData: FormData) {
    const file = formData.get('file') as File;
    if (!file) return { success: false, error: 'No file uploaded' };

    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(backupDir, file.name);
    fs.writeFileSync(filePath, buffer);

    revalidatePath('/');
    return { success: true, filename: file.name };
}

// Helper: Check if a host port is in use
async function isPortAvailable(port: number): Promise<boolean> {
    const net = await import('node:net');

    // 1. Check if ANY process is listening on the host
    const isFreeOnHost = await new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        server.listen(port, '0.0.0.0');
    });

    if (!isFreeOnHost) return false;

    // 2. Check Docker's internal port mappings (important for Windows/WSL)
    try {
        const containers = await docker.listContainers();
        for (const c of containers) {
            for (const p of c.Ports) {
                if (p.PublicPort === port) return false;
            }
        }
    } catch (e) {
        console.warn("Docker port check failed, falling back to host check only", e);
    }

    return true;
}

// Helper: Find next available port
async function findAvailablePort(startPort: number): Promise<number> {
    let port = startPort;
    while (!(await isPortAvailable(port)) && port < 65535) {
        port++;
    }
    return port;
}

export async function restoreToNewContainer(filename: string, networkOverride?: string, jobId?: string): Promise<{ success: boolean; error?: string; newName?: string; message?: string; results?: any[] }> {
    const backupDir = path.join(process.cwd(), 'backups');
    const filePath = path.join(backupDir, filename);

    // Helper for progress updates
    const updateProgress = (msg: string) => {
        if (jobId) updateJobStatus(jobId, 'processing', msg);
        console.log(`[Restore] ${msg}`);
    };

    if (!fs.existsSync(filePath)) {
        if (jobId) updateJobStatus(jobId, 'failed', 'File not found');
        return { success: false, error: "File not found" };
    }

    try {
        const zip = new AdmZip(filePath);

        // CHECK IF STACK BACKUP (Contains other zips, no config.json at root)
        if (!zip.getEntry('config.json') && zip.getEntries().some(e => e.entryName.endsWith('.zip'))) {
            // --- STACK RESTORE MODE ---
            updateProgress(`Detected Stack Backup: ${filename}`);

            // 1. Create Shared Network
            const stackId = Date.now();
            const netName = `stack_restore_${stackId}`;
            updateProgress(`Creating Stack Network: ${netName}`);
            await docker.createNetwork({ Name: netName, Driver: 'bridge' });

            // 2. Extract and Restore Children (databases first for proper startup order)
            const entries = zip.getEntries().filter(e => e.entryName.endsWith('.zip'));

            // Sort: databases (postgres, mysql, redis) first, then apps
            const dbKeywords = ['postgres', 'mysql', 'mariadb', 'redis', 'db'];
            entries.sort((a, b) => {
                const aIsDb = dbKeywords.some(k => a.entryName.toLowerCase().includes(k));
                const bIsDb = dbKeywords.some(k => b.entryName.toLowerCase().includes(k));
                if (aIsDb && !bIsDb) return -1;
                if (!aIsDb && bIsDb) return 1;
                return 0;
            });

            const results = [];

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                updateProgress(`Restoring ${i + 1}/${entries.length}: ${entry.entryName}`);

                // Extract to temp file
                const tempChildPath = path.join(backupDir, `temp_${stackId}_${entry.entryName}`);

                try {
                    fs.writeFileSync(tempChildPath, entry.getData());

                    // Recursive Restore with Network Override
                    const res = await restoreToNewContainer(path.basename(tempChildPath), netName);
                    results.push({ name: entry.entryName, ...res });
                } catch (childErr: any) {
                    console.error(`[Restore] Failed to restore ${entry.entryName}:`, childErr);
                    results.push({ name: entry.entryName, success: false, error: childErr.message });
                }

                // Cleanup temp
                if (fs.existsSync(tempChildPath)) fs.unlinkSync(tempChildPath);
            }

            const failedCount = results.filter(r => !r.success).length;
            const msg = failedCount > 0
                ? `Stack Restored with ${failedCount} errors (network: ${netName})`
                : `Stack Restored (${entries.length} containers, network: ${netName})`;

            if (jobId) updateJobStatus(jobId, failedCount > 0 ? 'failed' : 'completed', msg);
            return { success: failedCount === 0, message: msg, results };
        }

        // --- SINGLE CONTAINER RESTORE MODE ---
        const configEntry = zip.getEntry('config.json');
        if (!configEntry) {
            if (jobId) updateJobStatus(jobId, 'failed', 'Invalid Backup: config.json missing');
            return { success: false, error: "Invalid Backup: config.json missing" };
        }

        const config = JSON.parse(configEntry.getData().toString('utf8'));
        const newName = `${config.name.replace('/', '').replace(/[:]/g, '')}_restored_${Date.now()}`;

        updateProgress(`Creating container ${newName} from ${config.image}`);

        // Check if image exists locally
        try {
            const image = docker.getImage(config.image);
            await image.inspect();
        } catch (err: any) {
            if (err.statusCode === 404) {
                updateProgress(`Pulling image ${config.image}...`);

                // Add timeout for image pull (5 minutes)
                const pullPromise = new Promise((resolve, reject) => {
                    docker.pull(config.image, (err: any, stream: any) => {
                        if (err) return reject(err);
                        docker.modem.followProgress(stream, (err: any, output: any) => err ? reject(err) : resolve(output));
                    });
                });

                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Image pull timed out after 5 minutes: ${config.image}`)), 300000)
                );

                await Promise.race([pullPromise, timeoutPromise]);
            } else {
                throw err;
            }
        }

        // --- NETWORKING ---
        const networkingConfig: any = { EndpointsConfig: {} };

        if (networkOverride) {
            // FORCE Attach to shared stack network
            // Collect aliases from original config to preserve service discovery (e.g. 'postgres', 'redis')
            const allAliases = new Set<string>();

            // Add compose service name as alias (most important for service discovery)
            if (config.composeService) {
                allAliases.add(config.composeService); // e.g., 'postgres', 'redis', 'main'
            }

            // Add original container name (without leading slash)
            const cleanName = config.name.replace('/', '');
            allAliases.add(cleanName);

            networkingConfig.EndpointsConfig[networkOverride] = {
                Aliases: Array.from(allAliases)
            };
        } else {
            // Fallback to original network or default bridge
            const networks = Object.keys(config.networkSettings?.Networks || {});
            const targetNet = networks.length > 0 ? networks[0] : 'bridge';

            // Check if network exists, if not create bridge
            try {
                const net = docker.getNetwork(targetNet);
                await net.inspect();
            } catch (err) {
                updateProgress(`Network ${targetNet} not found, using 'bridge'`);
                networkingConfig.EndpointsConfig['bridge'] = {};
            }

            if (!networkingConfig.EndpointsConfig[targetNet]) {
                networkingConfig.EndpointsConfig[targetNet] = {};
            }
        }

        // --- PORT CONFLICT RESOLUTION ---
        const exposedPorts: any = {};
        const portBindings: any = {};

        if (config.hostConfig?.PortBindings) {
            updateProgress('Resolving Port Conflicts...');
            for (const [containerPort, bindings] of Object.entries(config.hostConfig.PortBindings)) {
                exposedPorts[containerPort] = {};
                const newBindings = [];

                for (const binding of (bindings as any[])) {
                    const originalHostPort = parseInt(binding.HostPort);
                    const availablePort = await findAvailablePort(originalHostPort);

                    if (availablePort !== originalHostPort) {
                        updateProgress(`Port Conflict: ${originalHostPort} in use. Using ${availablePort}`);
                    }

                    newBindings.push({
                        HostIp: binding.HostIp || '0.0.0.0',
                        HostPort: availablePort.toString()
                    });
                }
                portBindings[containerPort] = newBindings;
            }
        }

        // --- VOLUME CONFLICT RESOLUTION ---
        const binds = [];
        if (config.hostConfig?.Binds) {
            updateProgress('Checking Volume Paths...');
            for (const bind of config.hostConfig.Binds) {
                const [hostPath, containerPath] = bind.split(':');
                let targetHostPath = hostPath;

                // If host path exists and is not empty, check for collision
                if (fs.existsSync(hostPath)) {
                    // If it's a directory and has files, maybe it's from a previous install
                    // To be safe, we append a suffix for "restored" data
                    targetHostPath = `${hostPath}_restored_${Date.now()}`;
                    updateProgress(`Path Conflict: ${hostPath} exists. Using ${targetHostPath}`);
                }

                // Ensure parent directory exists
                const parentDir = path.dirname(targetHostPath);
                if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

                binds.push(`${targetHostPath}:${containerPath}`);
            }
        }

        // Create Container
        const container = await docker.createContainer({
            name: newName,
            Image: config.image,
            Env: config.env,
            ExposedPorts: exposedPorts,
            HostConfig: {
                ...config.hostConfig,
                PortBindings: portBindings,
                Binds: binds,
                RestartPolicy: { Name: 'unless-stopped' }
            },
            NetworkingConfig: networkingConfig
        });

        updateProgress(`Starting container...`);
        await container.start();

        // --- RESTORE DATA ---
        updateProgress(`Restoring data into volumes...`);
        const zipEntries = zip.getEntries();
        for (const entry of zipEntries) {
            if (entry.entryName.endsWith('.tar')) {
                let originalPath = entry.entryName.replace(/_/g, '/').replace('.tar', '');
                if (!originalPath.startsWith('/')) originalPath = '/' + originalPath;
                const parentDir = path.dirname(originalPath);

                console.log(`[Restore] Putting volume ${entry.entryName} to ${parentDir}`);
                const buffer = entry.getData();
                try {
                    await container.putArchive(buffer, { path: parentDir });
                } catch (err: any) {
                    console.error(`[Restore] Failed to put archive: ${err.message}`);
                }
            }
        }

        const msg = `Restored successfully as ${newName}`;
        if (jobId) updateJobStatus(jobId, 'completed', msg);

        addHistoryEntry({
            id: Date.now().toString(),
            date: new Date().toISOString(),
            containerName: newName,
            status: 'success',
            destination: 'local',
            message: `Cloned from ${filename}`,
        });

        return { success: true, newName, message: msg };

    } catch (error: any) {
        console.error("Restore failed:", error);
        if (jobId) updateJobStatus(jobId, 'failed', error.message);
        return { success: false, error: error.message };
    }
}
