const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

async function inspect(filename) {
    const filePath = path.join(__dirname, 'backups', filename);
    console.log('Inspecting:', filePath);
    
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    
    console.log('Entries:');
    entries.forEach(e => console.log(' -', e.entryName));
    
    const config = zip.getEntry('config.json');
    if (config) {
        console.log('\nConfig:', config.getData().toString());
    }
}

inspect(process.argv[2]);
