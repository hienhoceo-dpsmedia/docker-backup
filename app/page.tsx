import { getContainers } from "./actions";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function Home() {
    const containers = await getContainers();

    return (
        <DashboardClient initialContainers={containers} />
    );
}
