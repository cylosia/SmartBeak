import { createPublishingJobProcedure } from "./procedures/create-job";
import { getJobAttempts } from "./procedures/get-job-attempts";
import { listPublishingJobs } from "./procedures/list-jobs";

export const publishingRouter = {
	listJobs: listPublishingJobs,
	createJob: createPublishingJobProcedure,
	getJobAttempts,
};
