import { decide } from './decide.mjs';
import { respondToAlert } from '../shared/respond.mjs';
export const respond = (alert, options) => respondToAlert('known-cve', alert, decide(alert), options);
