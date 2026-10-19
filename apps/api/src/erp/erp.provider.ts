import { config } from '../config';
import { DemoErpAdapter } from './demo-erp.adapter';
import type { ErpAdapter } from './erp.adapter';
import { HttpErpAdapter } from './http-erp.adapter';

let instance: ErpAdapter | null = null;
export function erp(): ErpAdapter {
  if (!instance) {
    const c = config();
    instance = c.ERP_ADAPTER === 'http' ? new HttpErpAdapter(c.ERP_BASE_URL, c.ERP_API_KEY) : new DemoErpAdapter();
  }
  return instance;
}
export const ERP_TOKEN = 'ERP_ADAPTER';
