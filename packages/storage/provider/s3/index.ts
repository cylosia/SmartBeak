import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "@repo/logs";
import { config } from "../../config";
import type {
	GetSignedUploadUrlHandler,
	GetSignedUrlHandler,
} from "../../types";

let s3Client: S3Client | null = null;

const getS3Client = () => {
	if (s3Client) {
		return s3Client;
	}

	const s3Endpoint = process.env.S3_ENDPOINT;
	if (!s3Endpoint) {
		throw new Error("Missing env variable S3_ENDPOINT");
	}

	const s3Region = process.env.S3_REGION || "auto";

	const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
	if (!s3AccessKeyId) {
		throw new Error("Missing env variable S3_ACCESS_KEY_ID");
	}

	const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
	if (!s3SecretAccessKey) {
		throw new Error("Missing env variable S3_SECRET_ACCESS_KEY");
	}

	s3Client = new S3Client({
		region: s3Region,
		endpoint: s3Endpoint,
		forcePathStyle: true,
		credentials: {
			accessKeyId: s3AccessKeyId,
			secretAccessKey: s3SecretAccessKey,
		},
	});

	return s3Client;
};

const ALLOWED_CONTENT_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"application/pdf",
	"video/mp4",
	"video/webm",
	"audio/mpeg",
	"audio/wav",
]);

function inferContentType(path: string): string {
	const ext = path.split(".").pop()?.toLowerCase();
	const map: Record<string, string> = {
		jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
		webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
		pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm",
		mp3: "audio/mpeg", wav: "audio/wav",
	};
	return map[ext ?? ""] ?? "application/octet-stream";
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export const getSignedUploadUrl: GetSignedUploadUrlHandler = async (
	path,
	{ bucket },
) => {
	const bucketName =
		config.bucketNames[bucket as keyof typeof config.bucketNames];

	const contentType = inferContentType(path);
	if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
		throw new Error(`File type not allowed: ${contentType}`);
	}

	const s3Client = getS3Client();
	try {
		return await getS3SignedUrl(
			s3Client,
			new PutObjectCommand({
				Bucket: bucketName,
				Key: path,
				ContentType: contentType,
			}),
			{
				expiresIn: 60,
				conditions: [["content-length-range", 0, MAX_UPLOAD_BYTES]],
			},
		);
	} catch (e) {
		logger.error(e);

		throw new Error("Could not get signed upload url");
	}
};

export const getSignedUrl: GetSignedUrlHandler = async (
	path,
	{ bucket, expiresIn },
) => {
	const bucketName =
		config.bucketNames[bucket as keyof typeof config.bucketNames];

	if (!bucketName) {
		throw new Error("Invalid bucket");
	}

	const s3Client = getS3Client();
	try {
		return getS3SignedUrl(
			s3Client,
			new GetObjectCommand({ Bucket: bucketName, Key: path }),
			{ expiresIn },
		);
	} catch (e) {
		logger.error(e);
		throw new Error("Could not get signed url");
	}
};
