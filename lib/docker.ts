import Docker from 'dockerode';

let docker: Docker;

declare global {
    var __docker: Docker | undefined;
}

if (process.env.NODE_ENV === 'production') {
    docker = new Docker({ socketPath: '/var/run/docker.sock' });
} else {
    // Check environment for Windows Pipe support or Linux Socket
    if (!global.__docker) {
        // Attempting sensible defaults suitable for both environments
        // But for this tool specifically designed for Linux VPS deployment,
        // socketPath is usually the way.
        // If running dev on Windows with Docker Desktop:
        global.__docker = new Docker(); // Defaults to pipe or socket
    }
    docker = global.__docker;
}

export default docker;
