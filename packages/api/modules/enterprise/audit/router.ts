import {
	exportAuditLogsProcedure,
	getAuditRetentionProcedure,
	searchAuditLogsProcedure,
	setAuditRetentionProcedure,
} from "./procedures/manage-audit";

export const enterpriseAuditRouter = {
	search: searchAuditLogsProcedure,
	export: exportAuditLogsProcedure,
	retention: {
		get: getAuditRetentionProcedure,
		set: setAuditRetentionProcedure,
	},
};
