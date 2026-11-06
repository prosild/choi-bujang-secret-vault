import { readAlerts, printAlertsIfMain } from '../shared/read-alerts.mjs';
export const read = () => readAlerts(new URL('../fixtures/persistence.json', import.meta.url));
await printAlertsIfMain(import.meta.url, read);
