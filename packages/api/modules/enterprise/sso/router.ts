import {
	createScimTokenProcedure,
	deleteScimTokenProcedure,
	listScimTokens,
} from "./procedures/manage-scim";
import {
	deleteSsoProviderProcedure,
	listSsoProviders,
	updateSsoStatusProcedure,
	upsertSsoProviderProcedure,
} from "./procedures/manage-sso";

export const ssoRouter = {
	providers: {
		list: listSsoProviders,
		upsert: upsertSsoProviderProcedure,
		updateStatus: updateSsoStatusProcedure,
		delete: deleteSsoProviderProcedure,
	},
	scim: {
		listTokens: listScimTokens,
		createToken: createScimTokenProcedure,
		deleteToken: deleteScimTokenProcedure,
	},
};
