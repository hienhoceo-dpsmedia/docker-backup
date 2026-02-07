const Docker = require('dockerode');
const docker = new Docker();

async function test() {
    const containers = await docker.listContainers({ all: true });
    for (const cInfo of containers) {
        const container = docker.getContainer(cInfo.Id);
        const data = await container.inspect();
        console.log('---', data.Name, '---');
        console.log('Image:', data.Config.Image);
        console.log('Env:', data.Config.Env?.filter(e => e.includes('PASS') || e.includes('USER')));
        console.log('Mounts:', data.Mounts.map(m => `${m.Source} -> ${m.Destination} (${m.Type})`));
        console.log('Network:', Object.keys(data.NetworkSettings.Networks));
        console.log('Ports:', data.NetworkSettings.Ports);
        console.log('Labels:', data.Config.Labels);
        console.log('\n');
    }
}

test().catch(console.error);
