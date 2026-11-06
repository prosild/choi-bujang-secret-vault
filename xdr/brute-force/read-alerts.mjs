import { readAlerts, printAlertsIfMain } from '../shared/read-alerts.mjs';
export const read = () => readAlerts(new URL('../fixtures/brute-force.json', import.meta.url));
await printAlertsIfMain(import.meta.url, read);
