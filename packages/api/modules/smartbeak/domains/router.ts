import { createDomainProcedure } from "./procedures/create-domain";
import { deleteDomainProcedure } from "./procedures/delete-domain";
import { getDomain } from "./procedures/get-domain";
import { listDomains } from "./procedures/list-domains";
import { updateDomainProcedure } from "./procedures/update-domain";

export const domainsRouter = {
	list: listDomains,
	get: getDomain,
	create: createDomainProcedure,
	update: updateDomainProcedure,
	delete: deleteDomainProcedure,
};
