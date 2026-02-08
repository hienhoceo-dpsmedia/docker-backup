'use server';

import docker from '@/lib/docker';
import { backupQueue, updateJobStatus, getAllJobs } from '@/lib/queue';
import {
    addHistoryEntry,
    getHistory,
    getSettings,
    saveSettings,
    AppSettings,
    HistoryEntry,
    getStacks,
    saveStack,
    deleteStack as deleteStackStore,
    StackConfig
} from '@/lib/storage'; // Added imports
import { parseStackYaml } from '@/lib/stack-parser';

// Re-export types for client components (without node:fs)
export type { AppSettings, HistoryEntry, StackConfig } from '@/lib/storage';

import fs from 'node:fs';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import archiver from 'archiver'; // Installed dependency
import AdmZip from 'adm-zip'; // Installed for restore
import yaml from 'js-yaml'; // For YAML parsing in conflict resolution

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

// Stack Actions
export async function getStacksAction() {
    return getStacks();
}

export async function importStackAction(yaml: string, name?: string, envVars?: Record<string, string>) {
    try {
        const parsed = parseStackYaml(yaml);
        const stackName = name || parsed.name || `stack-${Date.now()}`;

        const config: StackConfig = {
            name: stackName,
            yaml,
            envVars, // Save environment variables
            services: parsed.services,
            lastUpdated: new Date().toISOString()
        };

        saveStack(config);
        revalidatePath('/');
        return { success: true, name: stackName };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function deleteStackAction(name: string) {
    deleteStackStore(name);
    revalidatePath('/');
    return { success: true };
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

export async function triggerUnifiedStackBackup(stackName: string) {
    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const filePath = path.join(backupDir, `stack_${stackName}_${Date.now()}.zip`);
    const virtualId = `stack-${stackName}`; // For status tracking

    try {
        updateJobStatus(virtualId, 'processing', `Starting Unified Backup for ${stackName}...`);

        const containers = await docker.listContainers({ all: true });

        // Match by project label (primary) or fallback to service labels
        let stackContainers = containers.filter(c =>
            c.Labels?.['com.docker.compose.project'] === stackName
        );

        if (stackContainers.length === 0) {
            const stacks = getStacks();
            const stack = stacks[stackName];
            const serviceNames = stack ? Object.keys(stack.services) : [];
            stackContainers = containers.filter(c => {
                const s = c.Labels?.['com.docker.compose.service'];
                return s && serviceNames.includes(s);
            });
        }

        if (stackContainers.length === 0) {
            throw new Error(`No containers found for stack "${stackName}"`);
        }

        const output = fs.createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        await new Promise<void>(async (resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Unified Backup timeout")), 600000);
            output.on('close', () => { clearTimeout(timeout); resolve(); });
            archive.on('error', (err: any) => { clearTimeout(timeout); reject(err); });
            archive.pipe(output);

            const stacks = getStacks();
            const stackConfig = stacks[stackName];

            // 1. Root Metadata
            const stackMetadata = {
                stackName,
                timestamp: new Date().toISOString(),
                containers: stackContainers.map(c => ({
                    id: c.Id,
                    name: c.Names[0].replace('/', ''),
                    service: c.Labels?.['com.docker.compose.service'] || 'unknown'
                }))
            };
            archive.append(JSON.stringify(stackMetadata, null, 2), { name: 'stack_metadata.json' });

            // 2. Source YAML
            if (stackConfig?.yaml) {
                archive.append(stackConfig.yaml, { name: 'docker-compose.yml' });
            }

            // 2.5. Environment File (if configured)
            // Priority: envVars > envFile
            if (stackConfig?.envVars && Object.keys(stackConfig.envVars).length > 0) {
                // Generate .env from envVars
                const envContent = Object.entries(stackConfig.envVars)
                    .map(([key, value]) => `${key}=${value}`)
                    .join('\n');
                archive.append(envContent, { name: '.env' });
                updateJobStatus(virtualId, 'processing', `Including environment variables...`);
            } else if (stackConfig?.envFile && fs.existsSync(stackConfig.envFile)) {
                // Fallback to reading from file
                try {
                    const envContent = fs.readFileSync(stackConfig.envFile, 'utf-8');
                    archive.append(envContent, { name: '.env' });
                    updateJobStatus(virtualId, 'processing', `Including .env file...`);
                } catch (err: any) {
                    console.warn(`[Stack Backup] Failed to read .env file: ${err.message}`);
                }
            }

            // 3. Service Data
            for (let i = 0; i < stackContainers.length; i++) {
                const c = stackContainers[i];
                const cName = c.Names[0].replace('/', '');
                updateJobStatus(virtualId, 'processing', `Archiving Service [${i + 1}/${stackContainers.length}]: ${cName}`);
                await archiveContainerInternal(archive, c.Id, `services/${cName}`);
            }

            archive.finalize();
        });

        // 4. Handle Final Artifact
        await handleUpload(virtualId, filePath);
        revalidatePath('/');
        return { success: true, path: filePath };

    } catch (error: any) {
        console.error("Unified Stack Backup Error:", error);
        updateJobStatus(virtualId, 'failed', error.message);
        return { success: false, error: error.message };
    }
}

export async function triggerStackBackup(stackName: string) {
    // Legacy support or alias to unified
    return triggerUnifiedStackBackup(stackName);
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

// Helper: Logic to append a container's data into an EXSITING archiver instance
// Used by both single backup and unified stack backup
async function archiveContainerInternal(archive: archiver.Archiver, containerId: string, prefix: string = '', customPaths?: string[]): Promise<void> {
    updateJobStatus(containerId, 'processing', 'Step: Inspecting Container...');
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const image = info.Config.Image;
    const name = info.Name.replace('/', '');
    const appType = detectAppType(image, info.Config.Labels);

    // 1. DATABASE DUMP (if applicable)
    if (image.includes('postgres') || image.includes('timescale') || image.includes('mysql') || image.includes('mariadb')) {
        updateJobStatus(containerId, 'processing', 'Step: DB Strategy Detected');
        const backupDir = path.join(process.cwd(), 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const tempSqlPath = path.join(backupDir, `temp_${name}_${Date.now()}.sql`);
        let cmd: string[] = [];

        const getEnv = (key: string) => {
            const envStr = info.Config.Env?.find((e: string) => e.startsWith(`${key}=`));
            if (!envStr) return null;
            return envStr.split('=').slice(1).join('=');
        };

        if (image.includes('postgres') || image.includes('timescale')) {
            const pgUser = getEnv('POSTGRES_USER') || 'postgres';
            const pgPwd = getEnv('POSTGRES_PASSWORD') || getEnv('POSTGRES_PASS');
            cmd = pgPwd
                ? ['sh', '-c', `PGPASSWORD='${pgPwd.replace(/'/g, "'\\''")}' pg_dumpall -U '${pgUser}' -w --clean --if-exists`]
                : ['sh', '-c', `pg_dumpall -U '${pgUser}' -w --clean --if-exists`];
        } else {
            const mysqlPwd = getEnv('MYSQL_ROOT_PASSWORD');
            cmd = mysqlPwd
                ? ['sh', '-c', `mysqldump -u root -p"${mysqlPwd}" --all-databases`]
                : ['sh', '-c', 'mysqldump -u root --all-databases --skip-lock-tables'];
        }

        updateJobStatus(containerId, 'processing', 'Step: Executing Dump...');
        console.log(`[Backup] Starting DB dump for ${name}...`);
        const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.error(`[Backup] DB Dump timeout for ${name}`);
                reject(new Error("DB Dump timeout"));
            }, 300000);

            exec.start({}, (err: any, stream: any) => {
                if (err) {
                    clearTimeout(timeout);
                    console.error(`[Backup] Exec start error for ${name}:`, err);
                    return reject(err);
                }
                const fileStream = fs.createWriteStream(tempSqlPath);

                // Use a safe demux for reliable output capture
                container.modem.demuxStream(stream, fileStream, process.stderr);

                stream.on('end', () => {
                    console.log(`[Backup] Stream ended for ${name} DB dump`);
                    fileStream.end();
                });

                fileStream.on('finish', () => {
                    clearTimeout(timeout);
                    console.log(`[Backup] File stream finished for ${name} DB dump`);
                    try {
                        if (fs.statSync(tempSqlPath).size === 0) {
                            reject(new Error("Empty SQL Dump"));
                        } else {
                            resolve();
                        }
                    } catch (e: any) {
                        reject(new Error(`SQL Dump file error: ${e.message}`));
                    }
                });

                fileStream.on('error', (e: any) => {
                    clearTimeout(timeout);
                    console.error(`[Backup] File stream error for ${name}:`, e);
                    reject(e);
                });

                stream.on('error', (e: any) => {
                    clearTimeout(timeout);
                    console.error(`[Backup] Socket stream error for ${name}:`, e);
                    reject(e);
                });
            });
        });

        // Append to archive
        const sqlBuffer = fs.readFileSync(tempSqlPath);
        archive.append(sqlBuffer, { name: path.join(prefix, 'dump.sql') });
        if (fs.existsSync(tempSqlPath)) fs.unlinkSync(tempSqlPath);
    }

    // 2. VOLUME/CONFIG BACKUP (STRICT MODE)
    const pathsToBackup = new Set<string>();
    const stackName = info.Config.Labels?.['com.docker.compose.project'];
    const serviceName = info.Config.Labels?.['com.docker.compose.service'];

    if (stackName) {
        const stacks = getStacks();
        const stackConfig = stacks[stackName];
        if (stackConfig && serviceName && stackConfig.services[serviceName]) {
            stackConfig.services[serviceName].volumes.forEach(v => {
                if (v && v.trim()) pathsToBackup.add(v.trim());
            });
        }
    }

    if (customPaths) {
        customPaths.forEach(p => { if (p.trim()) pathsToBackup.add(p.trim()); });
    }

    const uniquePaths = Array.from(pathsToBackup);

    // Metadata
    const configData = {
        name: info.Name,
        image: info.Config.Image,
        env: info.Config.Env,
        ports: info.Config.ExposedPorts,
        hostConfig: info.HostConfig,
        cmd: info.Config.Cmd,
        networkSettings: info.NetworkSettings,
        appType,
        backupPaths: uniquePaths,
        timestamp: new Date().toISOString()
    };
    archive.append(JSON.stringify(configData, null, 2), { name: path.join(prefix, 'config.json') });

    if (uniquePaths.length > 0) {
        for (const volPath of uniquePaths) {
            try {
                updateJobStatus(containerId, 'processing', `Archiving: ${volPath}`);
                console.log(`[Backup] Archiving volume ${volPath} for ${containerId}...`);
                const tarStream = await container.getArchive({ path: volPath });
                const safeName = volPath.replace(/[\/\\]/g, '_').replace(/^_/, '') + '.tar';

                // Wrap in promise to ensure stream completion if possible, though archiver handle it
                archive.append(tarStream as any, { name: path.join(prefix, 'volumes', safeName) });
                console.log(`[Backup] Volume ${volPath} added to archive.`);
            } catch (err: any) {
                console.error(`[Backup] Failed to archive volume ${volPath}:`, err);
                archive.append(`Failed: ${err.message}`, { name: path.join(prefix, `ERROR_${volPath.replace(/[\/\\]/g, '_')}.txt`) });
            }
        }
    } else {
        archive.append(Buffer.from("No volumes defined."), { name: path.join(prefix, 'volumes_none.txt') });
    }
}

// Helper: Generates the backup artifact (Zip) on disk
async function generateBackupFile(containerId: string, backupDir: string, customPaths?: string[]): Promise<string> {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const name = info.Name.replace('/', '');
    const filePath = path.join(backupDir, `${name}_${Date.now()}.zip`);

    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Backup timed out")), 400000);
        output.on('close', () => { clearTimeout(timeout); resolve(); });
        archive.on('error', (err: any) => { clearTimeout(timeout); reject(err); });
        archive.pipe(output);

        await archiveContainerInternal(archive, containerId, '', customPaths);

        archive.finalize();
    });

    return filePath;
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

// Helper: Restore a single container from a Zip (used by both single and unified restore)
// Helper to resolve ${VAR} placeholders using envMap or process.env
function resolveEnvValue(val: string, envMap?: Record<string, string>): string {
    if (!val) return val;
    return val.replace(/\${([^}:-]+)(?::-([^}]*))?}/g, (_, key, defaultValue) => {
        return envMap?.[key] || process.env[key] || defaultValue || '';
    });
}

// Helper: Restore volumes for a container while it is STOPPED
async function restoreVolumesInternal(containerId: string, zip: AdmZip, prefix: string = '', envMap?: Record<string, string>) {
    const container = docker.getContainer(containerId);

    console.log(`[Restore] Phase 0: Restoring volumes for ${containerId} while stopped...`);

    const volumesPrefix = path.join(prefix, 'volumes/').replace(/\\/g, '/');
    const volumeEntries = zip.getEntries().filter(e => e.entryName.startsWith(volumesPrefix) && e.entryName.endsWith('.tar'));

    for (const entry of volumeEntries) {
        const rawName = entry.entryName.replace(volumesPrefix, '').replace('.tar', '');
        let originalPath = rawName.replace(/_/g, '/');
        if (!originalPath.startsWith('/')) originalPath = '/' + originalPath;

        const parentDir = path.dirname(originalPath);

        console.log(`[Restore] Putting volume ${entry.entryName} to ${parentDir}`);
        updateJobStatus(containerId, 'processing', `Restoring Volume (Offline): ${originalPath}...`);

        try {
            await container.putArchive(entry.getData(), { path: parentDir });
        } catch (err: any) {
            console.error(`[Restore] Failed to put archive while stopped: ${err.message}`);
            updateJobStatus(containerId, 'processing', `Warning: Failed to restore ${originalPath}`);
        }
    }
}

// Helper: Restore SQL dump for a container while it is RUNNING
async function restoreSqlInternal(containerId: string, zip: AdmZip, prefix: string = '', envMap?: Record<string, string>) {
    const container = docker.getContainer(containerId);

    const dumpPath = path.join(prefix, 'dump.sql').replace(/\\/g, '/');
    const dumpEntry = zip.getEntries().find(e => e.entryName === dumpPath);

    if (!dumpEntry) return;

    const dumpSize = dumpEntry.header.size;
    if (dumpSize < 100) {
        console.warn(`[Restore] SQL dump for ${containerId} is suspiciously small (${dumpSize} bytes).`);
        updateJobStatus(containerId, 'processing', `⚠️ Warning: SQL dump is very small (${dumpSize} bytes).`);
    }

    updateJobStatus(containerId, 'processing', 'Found SQL Dump. Restoring Database...');

    const tempDumpPath = path.join(process.cwd(), 'backups', `temp_restore_${Date.now()}.sql`);
    fs.writeFileSync(tempDumpPath, dumpEntry.getData());

    try {
        const info = await container.inspect();
        const image = info.Config.Image.toLowerCase();
        let cmd: string[] = [];
        const env = info.Config.Env || [];
        let pgUser: string | undefined;
        let pgPwd: string | undefined;
        let pgDb: string | undefined;

        if (image.includes('postgres') || image.includes('timescale')) {
            pgUser = resolveEnvValue(env.find((e: string) => e.startsWith('POSTGRES_USER='))?.split('=')[1] || 'postgres', envMap);
            pgPwd = resolveEnvValue(env.find((e: string) => e.startsWith('POSTGRES_PASSWORD='))?.split('=')[1] || env.find((e: string) => e.startsWith('POSTGRES_PASS='))?.split('=')[1] || '', envMap);
            pgDb = resolveEnvValue(env.find((e: string) => e.startsWith('POSTGRES_DB='))?.split('=')[1] || pgUser || 'postgres', envMap);

            const targetDb = 'postgres';
            cmd = pgPwd
                ? ['sh', '-c', `PGPASSWORD='${pgPwd.replace(/'/g, "'\\''")}' psql -U '${pgUser}' -d '${targetDb}'`]
                : ['psql', '-U', pgUser || 'postgres', '-d', targetDb];

            console.log(`[Restore] Targeting database "${targetDb}" for SQL restore...`);
        } else if (image.includes('mysql') || image.includes('mariadb')) {
            const pwd = env.find((e: string) => e.startsWith('MYSQL_ROOT_PASSWORD='))?.split('=')[1];
            cmd = pwd ? ['mysql', '-u', 'root', `-p${pwd}`] : ['mysql', '-u', 'root'];
        }

        if (cmd.length > 0) {
            const exec = await container.exec({
                Cmd: cmd,
                AttachStdin: true,
                AttachStdout: true,
                AttachStderr: true,
                Tty: false
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("SQL Restore Timeout")), 300000);
                const fileStream = fs.createReadStream(tempDumpPath);

                exec.start({ hijack: true, stdin: true }, (err: any, stream: any) => {
                    if (err) { clearTimeout(timeout); return reject(err); }

                    let restoreOutput = '';
                    stream.on('data', (chunk: Buffer) => { restoreOutput += chunk.toString(); });
                    fileStream.pipe(stream);

                    fileStream.on('end', () => {
                        setTimeout(() => {
                            stream.end();
                            clearTimeout(timeout);
                            console.log(`[Restore] SQL Restore finished. Output: ${restoreOutput.slice(-200)}`);
                            resolve();
                        }, 2000);
                    });
                    stream.on('error', (e: any) => { clearTimeout(timeout); reject(e); });
                });
            });

            // Credential Sync (Postgres only)
            if ((image.includes('postgres') || image.includes('timescale')) && pgUser && pgPwd) {
                console.log(`[Restore] Syncing credentials for role "${pgUser}" using explicit DB flags...`);
                // Note: We avoid 'DROP ROLE IF EXISTS' here because if pgUser is the only superuser, 
                // it cannot drop itself during the dump restore. We just ensure the password is correct.
                const sqlSequence = `
                    DO $$ 
                    BEGIN 
                        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${pgUser.replace(/'/g, "''")}') THEN 
                            CREATE ROLE "${pgUser.replace(/"/g, '""')}" WITH LOGIN PASSWORD '${pgPwd.replace(/'/g, "''")}'; 
                        END IF; 
                    END $$;
                    ALTER ROLE "${pgUser.replace(/"/g, '""')}" WITH PASSWORD '${pgPwd.replace(/'/g, "''")}';
                    ALTER ROLE "${pgUser.replace(/"/g, '""')}" SUPERUSER;
                `.trim();

                // Connect as the actual pgUser with its actual password, targeting 'postgres' maintenance DB
                // We use single quotes for the -c argument to prevent shell interpolation of $$
                const syncExec = await container.exec({
                    Cmd: ['sh', '-c', `PGPASSWORD='${pgPwd.replace(/'/g, "'\\''")}' psql -U '${pgUser}' -d 'postgres' -c '${sqlSequence.replace(/'/g, "'\\''")}'`],
                    AttachStdout: true,
                    AttachStderr: true
                });

                await new Promise<void>((res) => {
                    syncExec.start({}, (err, stream) => {
                        if (err || !stream) return res();
                        let output = '';
                        stream.on('data', c => output += c.toString());
                        stream.on('end', () => {
                            if (output) console.log(`[Restore] Sync output: ${output.trim()}`);
                            res();
                        });
                        stream.on('error', () => res());
                    });
                });
            }
        }
    } finally {
        if (fs.existsSync(tempDumpPath)) fs.unlinkSync(tempDumpPath);
        updateJobStatus(containerId, 'processing', 'Database Restored.');
    }
}

// Deprecated: Please use restoreVolumesInternal and restoreSqlInternal instead
async function restoreContainerInternal(containerId: string, zip: AdmZip, prefix: string = '', envMap?: Record<string, string>) {
    await restoreVolumesInternal(containerId, zip, prefix, envMap);
    await restoreSqlInternal(containerId, zip, prefix, envMap);
}

export async function restoreBackup(filename: string, containerId: string) {
    try {
        updateJobStatus(containerId, 'processing', 'Restoring...');
        const backupDir = path.join(process.cwd(), 'backups');
        const filePath = path.join(backupDir, filename);
        if (!fs.existsSync(filePath)) throw new Error('Backup file not found');

        const container = docker.getContainer(containerId); // Validates ID

        // Check if it's a ZIP or direct SQL
        if (filename.endsWith('.zip')) {
            const zip = new AdmZip(filePath);
            await restoreContainerInternal(containerId, zip, '');
        } else if (filename.endsWith('.sql') || filename.endsWith('.sql.gz')) {
            // Legacy SQL restore or single file SQL restore
            // Reuse the existing logic? Or wrap it in a zip structure?
            // For now, let's just keep the old logic but simplified, 
            // OR assume users mostly use ZIPs now. 
            // Let's implement a quick direct restore here for backward compat.
            const info = await container.inspect();
            const image = info.Config.Image;
            let cmd = ['mysql', '-u', 'root']; // Default fallback
            if (image.includes('postgres')) cmd = ['psql', '-U', 'postgres'];

            const fileStream = fs.createReadStream(filePath);
            const exec = await container.exec({
                Cmd: cmd,
                AttachStdin: true,
                AttachStdout: true,
                AttachStderr: true,
                Tty: false
            });
            // ... (Simple stream pipe, omitting full error handling for brevity in this fix)
            await new Promise<void>((resolve, reject) => {
                exec.start({ hijack: true, stdin: true }, (err: any, stream: any) => {
                    if (err) return reject(err);
                    fileStream.pipe(stream);
                    fileStream.on('end', () => { stream.end(); resolve(); });
                });
            });
        }

        updateJobStatus(containerId, 'completed', 'Restored Successfully');

        // Get container name for history
        const info = await container.inspect();

        addHistoryEntry({
            id: Date.now().toString(),
            date: new Date().toISOString(),
            containerName: info.Name?.replace('/', '') || containerId,
            status: 'success',
            destination: 'local',
            message: `Restored from ${filename}`,
        });
        return { success: true };

    } catch (error: any) {
        console.error("Restore failed:", error);
    }
}

export async function restoreUnifiedStackBackup(filename: string, targetStackName?: string) {
    const virtualId = `restore-stack-${Date.now()}`;
    try {
        updateJobStatus(virtualId, 'processing', `Reading backup archive...`);

        const backupDir = path.join(process.cwd(), 'backups');
        const filePath = path.join(backupDir, filename);
        if (!fs.existsSync(filePath)) throw new Error('Backup file not found');

        const zip = new AdmZip(filePath);
        const stackMetadataEntry = zip.getEntry('stack_metadata.json');

        if (!stackMetadataEntry) {
            throw new Error('Invalid Stack Backup: Missing stack_metadata.json');
        }

        const metadata = JSON.parse(stackMetadataEntry.getData().toString('utf8'));
        const services = metadata.containers || [];

        // Use provided name or original name from backup
        const stackName = targetStackName || metadata.stackName;

        console.log(`[Unified Restore] Deploying stack "${stackName}" from backup...`);
        updateJobStatus(virtualId, 'processing', `Deploying stack "${stackName}"...`);

        // ALWAYS DEPLOY FROM BACKUP YML
        const composeEntry = zip.getEntry('docker-compose.yml');
        if (!composeEntry) {
            throw new Error(`Cannot restore: docker-compose.yml not found in backup.`);
        }

        const composeYaml = composeEntry.getData().toString('utf8');

        // SMART CONFLICT RESOLUTION
        updateJobStatus(virtualId, 'processing', `Analyzing conflicts...`);

        // Resolve port conflicts
        const portResolution = await resolvePortConflicts(composeYaml);
        let resolvedYaml = portResolution.yaml;

        if (portResolution.remappings.length > 0) {
            updateJobStatus(virtualId, 'processing', `⚠️ Port conflicts detected, auto-remapping...`);
            for (const remap of portResolution.remappings) {
                console.log(`[Conflict Resolution] ${remap}`);
            }
        }

        // Resolve container name conflicts
        const nameResolution = resolveContainerNameConflicts(resolvedYaml);
        resolvedYaml = nameResolution.yaml;

        if (nameResolution.removed.length > 0) {
            updateJobStatus(virtualId, 'processing', `🔧 Removing container_name fields to avoid conflicts...`);
            for (const removed of nameResolution.removed) {
                console.log(`[Conflict Resolution] Removed container_name from ${removed}`);
            }
        }

        // Resolve static IP conflicts
        const networkResolution = resolveNetworkConflicts(resolvedYaml);
        resolvedYaml = networkResolution.yaml;

        if (networkResolution.removed.length > 0) {
            updateJobStatus(virtualId, 'processing', `🌐 Stripping static IPs to avoid subnet conflicts...`);
            for (const msg of networkResolution.removed) {
                console.log(`[Conflict Resolution] ${msg}`);
            }
        }

        // Resolve healthcheck conflicts (strip/downgrade to avoid blocks)
        const hcResolution = resolveHealthcheckConflicts(resolvedYaml);
        resolvedYaml = hcResolution.yaml;

        if (hcResolution.removed.length > 0) {
            updateJobStatus(virtualId, 'processing', `🏥 Bypassing healthchecks during restore...`);
            for (const msg of hcResolution.removed) {
                console.log(`[Conflict Resolution] ${msg}`);
            }
        }

        // Strip DNS settings from services to avoid conflicts with host DNS
        const dnsResolution = stripDnsSettings(resolvedYaml);
        resolvedYaml = dnsResolution.yaml;

        if (dnsResolution.removed.length > 0) {
            updateJobStatus(virtualId, 'processing', `🚫 Stripping DNS settings to avoid conflicts...`);
            for (const msg of dnsResolution.removed) {
                console.log(`[Conflict Resolution] ${msg}`);
            }
        }

        // Import the stack configuration
        const importRes = await importStackAction(resolvedYaml, stackName);
        if (!importRes.success) {
            throw new Error(`Failed to import stack: ${importRes.error}`);
        }

        // 1. Ensure a clean state by stopping any existing stack with the same name
        try {
            const containers = await docker.listContainers({ all: true });
            const existing = containers.filter(c => c.Labels?.['com.docker.compose.project'] === stackName);
            if (existing.length > 0) {
                console.log(`[Unified Restore] Stopping existing stack containers for "${stackName}"...`);
                for (const c of existing) {
                    try {
                        const container = docker.getContainer(c.Id);
                        await container.stop({ t: 10 });
                        await container.remove({ v: true, force: true });
                    } catch (e) { /* ignore cleanup errors */ }
                }
            }
        } catch (err) {
            console.warn(`[Unified Restore] Clean state check failed:`, err);
        }

        // Deploy using docker-compose
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const tempComposeFile = path.join(backupDir, `temp_${stackName}_${Date.now()}.yml`);
        fs.writeFileSync(tempComposeFile, resolvedYaml); // Use resolved YAML

        // Extract and parse .env file if present
        const envEntry = zip.getEntry('.env');
        let tempEnvFile: string | undefined;
        const envMap: Record<string, string> = {};

        if (envEntry) {
            const envContent = envEntry.getData().toString('utf8');
            tempEnvFile = path.join(backupDir, `temp_${stackName}_${Date.now()}.env`);
            fs.writeFileSync(tempEnvFile, envContent);

            // Parse .env into envMap
            envContent.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const [key, ...parts] = trimmed.split('=');
                    envMap[key.trim()] = parts.join('=').trim();
                }
            });
            updateJobStatus(virtualId, 'processing', `Extracted and parsed .env file...`);
        }

        let targetContainers: any[] = [];

        try {
            // Ensure external networks exist before deploy
            updateJobStatus(virtualId, 'processing', `Ensuring external networks exist...`);
            await ensureExternalNetworks(resolvedYaml);

            // PHASE 1: Create without starting
            updateJobStatus(virtualId, 'processing', `Creating container infrastructure...`);
            const createCmd = tempEnvFile
                ? `docker-compose -f "${tempComposeFile}" --env-file "${tempEnvFile}" -p ${stackName} up -d --no-start`
                : `docker-compose -f "${tempComposeFile}" -p ${stackName} up -d --no-start`;
            await execAsync(createCmd);

            // Get all created containers
            const containers = await docker.listContainers({ all: true });
            targetContainers = containers.filter(c =>
                c.Labels?.['com.docker.compose.project'] === stackName
            );

            if (targetContainers.length === 0) {
                throw new Error(`Stack created but no containers found. Check docker-compose.yml syntax.`);
            }

            // PHASE 2: Restore Offline Volumes (Everything while stopped)
            updateJobStatus(virtualId, 'processing', `📁 Phase 0: Restoring filesystem volumes (Offline)...`);
            for (const c of targetContainers) {
                const service = services.find((s: any) => s.service === c.Labels?.['com.docker.compose.service']);
                if (service) {
                    const zipPrefix = `services/${service.name}`;
                    const hasVolumes = zip.getEntries().some(e => e.entryName.startsWith(path.join(zipPrefix, 'volumes/').replace(/\\/g, '/')));

                    if (hasVolumes) {
                        try {
                            await restoreVolumesInternal(c.Id, zip, zipPrefix, envMap);
                        } catch (err: any) {
                            console.error(`[Unified Restore] Offline volume restore failed for ${c.Names[0]}:`, err);
                        }
                    }
                }
            }

            // PHASE 3: Identify and Boot Databases
            const dbServices: any[] = [];
            const appServices: any[] = [];

            for (const c of targetContainers) {
                const info = await docker.getContainer(c.Id).inspect();
                const image = info.Config.Image.toLowerCase();
                const isDb = image.includes('postgres') || image.includes('timescale') ||
                    image.includes('mysql') || image.includes('mariadb') ||
                    image.includes('redis') || image.includes('mongo');

                const serviceInfo = {
                    containerId: c.Id,
                    name: c.Names[0].replace('/', ''),
                    serviceName: c.Labels?.['com.docker.compose.service'],
                    isDb
                };

                if (isDb) dbServices.push(serviceInfo);
                else appServices.push(serviceInfo);
            }

            // 3.1 Start Databases
            if (dbServices.length > 0) {
                updateJobStatus(virtualId, 'processing', `⚡ Phase 1: Booting database engines...`);
                for (const db of dbServices) {
                    console.log(`[Unified Restore] Starting database: ${db.name}`);
                    await docker.getContainer(db.containerId).start();
                }

                // Wait for readiness
                updateJobStatus(virtualId, 'processing', `⏳ Waiting for database engines to stabilize...`);
                for (const db of dbServices) {
                    let ready = false;
                    for (let i = 0; i < 30; i++) {
                        try {
                            const info = await docker.getContainer(db.containerId).inspect();
                            const image = info.Config.Image.toLowerCase();
                            const env = info.Config.Env || [];

                            let checkCmd = ['pg_isready'];
                            if (image.includes('postgres') || image.includes('timescale')) {
                                const pgUser = resolveEnvValue(env.find((e: string) => e.startsWith('POSTGRES_USER='))?.split('=')[1] || 'postgres', envMap);
                                checkCmd = ['pg_isready', '-U', pgUser];
                            }
                            if (image.includes('mysql') || image.includes('mariadb')) checkCmd = ['mysqladmin', 'ping'];
                            if (image.includes('redis')) checkCmd = ['redis-cli', 'ping'];

                            const checkExec = await docker.getContainer(db.containerId).exec({
                                Cmd: checkCmd,
                                AttachStdout: true,
                                AttachStderr: true
                            });

                            const isReady = await new Promise<boolean>((res) => {
                                checkExec.start({}, (err, stream) => {
                                    if (err || !stream) return res(false);
                                    let out = '';
                                    stream.on('data', c => out += c.toString());
                                    stream.on('end', () => res(out.toLowerCase().includes('accepting') || out.toLowerCase().includes('alive') || out.toLowerCase().includes('pong')));
                                    setTimeout(() => res(false), 2000);
                                });
                            });

                            if (isReady) {
                                ready = true;
                                break;
                            }
                        } catch (e) { /* retry */ }
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    if (!ready) console.warn(`[Unified Restore] Database ${db.name} failed readiness check.`);
                }
            }

            // PHASE 4: Restore SQL Dump and Credentials
            updateJobStatus(virtualId, 'processing', `📦 Phase 2: Injecting database records (Online)...`);
            for (const db of dbServices) {
                const service = services.find((s: any) => s.service === db.serviceName);
                if (service) {
                    const zipPrefix = `services/${service.name}`;
                    try {
                        await restoreSqlInternal(db.containerId, zip, zipPrefix, envMap);
                    } catch (err: any) {
                        console.error(`[Unified Restore] SQL restore failed for ${db.name}:`, err);
                    }
                }
            }

            // PHASE 5: Start Applications
            updateJobStatus(virtualId, 'processing', `🚀 Phase 3: Powering on applications...`);
            const startCmd = tempEnvFile
                ? `docker-compose -f "${tempComposeFile}" --env-file "${tempEnvFile}" -p ${stackName} up -d`
                : `docker-compose -f "${tempComposeFile}" -p ${stackName} up -d`;
            await execAsync(startCmd);

        } finally {
            // Cleanup temp files
            if (fs.existsSync(tempComposeFile)) {
                fs.unlinkSync(tempComposeFile);
            }
            if (tempEnvFile && fs.existsSync(tempEnvFile)) {
                fs.unlinkSync(tempEnvFile);
            }
        }

        const msg = `Stack "${stackName}" restored successfully. ${portResolution.remappings.length > 0 ? `\n📋 Port remappings: ${portResolution.remappings.join(', ')}` : ''}`;
        updateJobStatus(virtualId, 'completed', msg);

        addHistoryEntry({
            id: Date.now().toString(),
            date: new Date().toISOString(),
            containerName: stackName,
            status: 'success',
            destination: 'local',
            message: msg,
        });

        revalidatePath('/');
        return { success: true, message: msg };

    } catch (error: any) {
        console.error("Unified Restore failed:", error);
        updateJobStatus(virtualId, 'failed', `Stack Restore Error: ${error.message}`);
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

// Helper: Resolve port conflicts in docker-compose.yml
async function resolvePortConflicts(composeYaml: string): Promise<{ yaml: string; remappings: string[] }> {
    try {
        const doc = yaml.load(composeYaml) as any;
        const remappings: string[] = [];

        if (!doc || !doc.services) {
            return { yaml: composeYaml, remappings };
        }

        for (const [serviceName, serviceRaw] of Object.entries(doc.services as any)) {
            const service = serviceRaw as any;
            if (!service.ports || !Array.isArray(service.ports)) continue;

            const newPorts: string[] = [];
            for (const portMapping of service.ports) {
                const portStr = String(portMapping);

                // Parse port mapping: "5434:5432" or "5434"
                const match = portStr.match(/^(\d+):(\d+)$/);
                if (!match) {
                    newPorts.push(portStr); // Keep as-is if not standard format
                    continue;
                }

                const hostPort = parseInt(match[1]);
                const containerPort = parseInt(match[2]);

                // Check if host port is available
                const isAvailable = await isPortAvailable(hostPort);
                if (isAvailable) {
                    newPorts.push(portStr); // Keep original
                } else {
                    // Find next available port
                    const newHostPort = await findAvailablePort(hostPort + 1);
                    const newMapping = `${newHostPort}:${containerPort}`;
                    newPorts.push(newMapping);
                    remappings.push(`${serviceName}: ${hostPort} → ${newHostPort}`);
                    console.log(`[Conflict Resolution] Port ${hostPort} occupied, remapped to ${newHostPort} for ${serviceName}`);
                }
            }

            service.ports = newPorts;
        }

        const newYaml = yaml.dump(doc, { lineWidth: -1, noRefs: true });
        return { yaml: newYaml, remappings };
    } catch (error: any) {
        console.error('[Conflict Resolution] Failed to parse YAML:', error);
        return { yaml: composeYaml, remappings: [] };
    }
}

// Helper: Remove container_name fields to avoid naming conflicts
function resolveContainerNameConflicts(composeYaml: string): { yaml: string; removed: string[] } {
    try {
        const doc = yaml.load(composeYaml) as any;
        const removed: string[] = [];

        if (!doc || !doc.services) {
            return { yaml: composeYaml, removed };
        }

        for (const [serviceName, serviceRaw] of Object.entries(doc.services as any)) {
            const service = serviceRaw as any;
            if (service.container_name) {
                removed.push(`${serviceName} (was: ${service.container_name})`);
                delete service.container_name;
            }
        }

        const newYaml = yaml.dump(doc, { lineWidth: -1, noRefs: true });
        return { yaml: newYaml, removed };
    } catch (error: any) {
        console.error('[Conflict Resolution] Failed to remove container names:', error);
        return { yaml: composeYaml, removed: [] };
    }
}

// Helper: Remove static IP assignments (ipv4_address, ipv6_address) to avoid subnet conflicts
function resolveNetworkConflicts(composeYaml: string): { yaml: string; removed: string[] } {
    try {
        const doc = yaml.load(composeYaml) as any;
        const removed: string[] = [];

        if (!doc || !doc.services) {
            return { yaml: composeYaml, removed };
        }

        for (const [serviceName, serviceRaw] of Object.entries(doc.services as any)) {
            const service = serviceRaw as any;
            if (service.networks) {
                if (Array.isArray(service.networks)) {
                    // Standard list: nothing to strip here specifically for IPs
                } else {
                    // Object format:
                    // services:
                    //   app:
                    //     networks:
                    //       default:
                    //         ipv4_address: 172.16.238.10
                    for (const [netName, netConfig] of Object.entries(service.networks)) {
                        const config = netConfig as any;
                        if (config && (config.ipv4_address || config.ipv6_address)) {
                            if (config.ipv4_address) {
                                removed.push(`${serviceName} on ${netName}: ipv4_address ${config.ipv4_address}`);
                                delete config.ipv4_address;
                            }
                            if (config.ipv6_address) {
                                removed.push(`${serviceName} on ${netName}: ipv6_address ${config.ipv6_address}`);
                                delete config.ipv6_address;
                            }
                        }
                    }
                }
            }
        }

        const newYaml = yaml.dump(doc, { lineWidth: -1, noRefs: true });
        return { yaml: newYaml, removed };
    } catch (error: any) {
        console.error('[Conflict Resolution] Failed to remove static IPs:', error);
        return { yaml: composeYaml, removed: [] };
    }
}

// Helper: Strip healthchecks and downgrade depends_on to avoid blocking during volatile restore
function resolveHealthcheckConflicts(composeYaml: string): { yaml: string; removed: string[] } {
    try {
        const doc = yaml.load(composeYaml) as any;
        const removed: string[] = [];

        if (!doc || !doc.services) {
            return { yaml: composeYaml, removed };
        }

        for (const [serviceName, serviceRaw] of Object.entries(doc.services as any)) {
            const service = serviceRaw as any;

            // 1. Strip healthcheck
            if (service.healthcheck) {
                removed.push(`Healthcheck from ${serviceName}`);
                delete service.healthcheck;
            }

            // 2. Downgrade depends_on condition
            if (service.depends_on) {
                if (Array.isArray(service.depends_on)) {
                    // Array format: depends_on: [db, redis]
                } else {
                    // Object format: depends_on: { db: { condition: service_healthy } }
                    for (const [depName, depConfig] of Object.entries(service.depends_on)) {
                        const config = depConfig as any;
                        if (config && config.condition === 'service_healthy') {
                            removed.push(`Downgraded ${serviceName} dependency on ${depName} to service_started`);
                            config.condition = 'service_started';
                        }
                    }
                }
            }
        }
        const newYaml = yaml.dump(doc, { lineWidth: -1, noRefs: true });
        return { yaml: newYaml, removed };
    } catch (error: any) {
        console.error('[Conflict Resolution] Failed to resolve healthcheck conflicts:', error);
        return { yaml: composeYaml, removed: [] };
    }
}

// Helper: Strip DNS settings from services to avoid conflicts with host DNS
function stripDnsSettings(composeYaml: string): { yaml: string; removed: string[] } {
    try {
        const doc = yaml.load(composeYaml) as any;
        const removed: string[] = [];

        if (!doc || !doc.services) {
            return { yaml: composeYaml, removed };
        }

        for (const [serviceName, serviceRaw] of Object.entries(doc.services as any)) {
            const service = serviceRaw as any;
            if (service.dns) {
                removed.push(`dns from ${serviceName} (was: ${JSON.stringify(service.dns)})`);
                delete service.dns;
            }
            if (service.dns_search) {
                removed.push(`dns_search from ${serviceName}`);
                delete service.dns_search;
            }
        }

        const newYaml = yaml.dump(doc, { lineWidth: -1, noRefs: true });
        return { yaml: newYaml, removed };
    } catch (error: any) {
        console.error('[Conflict Resolution] Failed to strip DNS settings:', error);
        return { yaml: composeYaml, removed: [] };
    }
}

// Helper: Ensure external networks exist before running docker-compose
async function ensureExternalNetworks(composeYaml: string) {
    try {
        const yaml = await import('js-yaml');
        const doc = yaml.load(composeYaml) as any;
        if (!doc || !doc.networks) return;

        const networks = await docker.listNetworks();
        const existingNames = new Set(networks.map(n => n.Name));

        for (const [netName, netConfig] of Object.entries(doc.networks as any)) {
            const config = netConfig as any;
            if (config && config.external) {
                // In Compose:
                // networks:
                //   foo:
                //     external: true -> name is 'foo'
                //   bar:
                //     external: { name: 'actual_bar' } -> name is 'actual_bar'
                //   baz:
                //     external: 'actual_baz' -> name is 'actual_baz'

                let actualName = netName;
                if (typeof config.external === 'string') {
                    actualName = config.external;
                } else if (config.external.name) {
                    actualName = config.external.name;
                } else if (config.name) {
                    actualName = config.name;
                }

                if (!existingNames.has(actualName)) {
                    console.log(`[Restore] Creating missing external network: ${actualName}`);
                    await docker.createNetwork({
                        Name: actualName,
                        Driver: 'bridge',
                        CheckDuplicate: true // Safety check
                    });
                }
            }
        }
    } catch (err) {
        console.error("[Restore] Failed to ensure external networks:", err);
        // We don't throw here to let docker-compose try anyway, 
        // as it might have its own resolution or fail with a clearer message.
    }
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
