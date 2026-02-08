export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { initScheduler } = await import('./lib/scheduler');
        console.log('[Instrumentation] Initializing Backup Scheduler...');
        initScheduler();
    }
}
