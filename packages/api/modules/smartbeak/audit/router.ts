import { listAuditEvents } from "./procedures/list-audit-events";

export const auditRouter = {
  list: listAuditEvents,
};
