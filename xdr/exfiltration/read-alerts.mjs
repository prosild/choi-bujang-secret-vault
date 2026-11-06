import { readAlerts, printAlertsIfMain } from '../shared/read-alerts.mjs';
export const read = () => readAlerts(new URL('../fixtures/exfiltration.json', import.meta.url));
await printAlertsIfMain(import.meta.url, read);
