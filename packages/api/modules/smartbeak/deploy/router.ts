import { getDeployStatus } from "./procedures/get-deploy-status";
import { listThemes } from "./procedures/list-themes";
import { triggerDeploy } from "./procedures/trigger-deploy";

export const deployRouter = {
	trigger: triggerDeploy,
	status: getDeployStatus,
	themes: listThemes,
};
