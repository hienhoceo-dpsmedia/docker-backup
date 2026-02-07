import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: 'standalone',
    // Prevent Webpack from bundling native modules (dockerode, ssh2)
    serverExternalPackages: ['dockerode', 'ssh2'],

};

export default nextConfig;
