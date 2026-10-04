import * as policy from '../lib/extension/strictParity';
(globalThis as typeof globalThis & {SuperKPolicy:typeof policy}).SuperKPolicy=policy;
