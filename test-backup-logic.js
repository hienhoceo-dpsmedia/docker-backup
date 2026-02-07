const { generateBackupFile } = require('./app/actions');
const fs = require('fs');
const path = require('path');

// Mock Docker for testing
const mockDocker = {
    getContainer: (id) => ({
        inspect: async () => ({
            Id: id,
            Name: '/test-container',
            Config: { Image: 'nginx' },
            State: { Running: true },
            Mounts: [],
            NetworkSettings: { Networks: { bridge: {} } },
            HostConfig: { PortBindings: {} }
        }),
        exec: (opts) => ({
            start: (opts) => {
                const stream = new (require('stream').PassThrough)();
                stream.end('mock backup data');
                return stream;
            }
        })
    })
};

async function test() {
    console.log('Starting backup test...');
    try {
        const result = await generateBackupFile(['test-id']);
        console.log('Backup Result:', result);
        
        if (result.success) {
            const backupPath = path.join(process.cwd(), 'backups', result.filename);
            if (fs.existsSync(backupPath)) {
                console.log('OK: Backup file exists at', backupPath);
                // Clean up? 
            } else {
                console.log('FAIL: Backup file not found');
            }
        }
    } catch (err) {
        console.error('Test Failed:', err);
    }
}

// Set up environment
if (!fs.existsSync('./backups')) fs.mkdirSync('./backups');

// test(); 
// (Commented out because generateBackupFile imports from server-only context usually)
