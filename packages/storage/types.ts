import type { config } from "./config";

export type CreateBucketHandler = (
	name: string,
	options?: {
		public?: boolean;
	},
) => Promise<void>;

export type GetSignedUploadUrlHandler = (
	path: string,
	options: {
		bucket: keyof typeof config.bucketNames;
		size: number;
	},
) => Promise<string>;

export type GetSignedUrlHandler = (
	path: string,
	options: {
		bucket: keyof typeof config.bucketNames;
		expiresIn?: number;
	},
) => Promise<string>;

export type DeleteObjectHandler = (
	path: string,
	options: {
		bucket: keyof typeof config.bucketNames;
	},
) => Promise<void>;
