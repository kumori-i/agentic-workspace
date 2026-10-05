import type { WorkspaceBridge } from '../shared/types';

declare global { interface Window { workspace: WorkspaceBridge; } }
