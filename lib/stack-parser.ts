import yaml from 'js-yaml';

export interface ParsedService {
    name: string;
    image: string;
    volumes: string[];
    env: Record<string, string>;
}

export interface ParsedStack {
    name: string;
    services: Record<string, ParsedService>;
}

export function parseStackYaml(yamlContent: string): ParsedStack {
    try {
        const doc = yaml.load(yamlContent) as any;
        const services: Record<string, ParsedService> = {};

        if (doc && doc.services) {
            for (const [serviceName, config] of Object.entries(doc.services)) {
                const serviceConfig = config as any;
                const volumes: string[] = [];

                if (serviceConfig.volumes) {
                    serviceConfig.volumes.forEach((v: any) => {
                        if (typeof v === 'string') {
                            // Format: host:container:ro or container
                            const parts = v.split(':');
                            if (parts.length > 1) {
                                volumes.push(parts[1]);
                            } else {
                                volumes.push(parts[0]);
                            }
                        } else if (typeof v === 'object' && v.target) {
                            volumes.push(v.target);
                        }
                    });
                }

                const env: Record<string, string> = {};
                if (serviceConfig.environment) {
                    if (Array.isArray(serviceConfig.environment)) {
                        serviceConfig.environment.forEach((e: string) => {
                            const [k, v] = e.split('=');
                            if (k) env[k] = v || '';
                        });
                    } else {
                        Object.assign(env, serviceConfig.environment);
                    }
                }

                services[serviceName] = {
                    name: serviceName,
                    image: serviceConfig.image || '',
                    volumes,
                    env
                };
            }
        }

        // Try to guess stack name from top level or use 'pasted-stack'
        const stackName = doc.name || 'manual-stack';

        return {
            name: stackName,
            services
        };
    } catch (e) {
        console.error("YAML Parse Error:", e);
        throw new Error("Invalid Docker Compose YAML format");
    }
}
