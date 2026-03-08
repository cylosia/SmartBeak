import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { registerRoutes } from "./routes";
import { seedDatabase } from "./seed";

const app = express();
const httpServer = createServer(app);

declare module "http" {
	interface IncomingMessage {
		rawBody: unknown;
	}
}

app.use(
	express.json({
		limit: "1mb",
		verify: (req, _res, buf) => {
			req.rawBody = buf;
		},
	}),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
	const formattedTime = new Date().toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
		hour12: true,
	});

	console.log(`${formattedTime} [${source}] ${message}`);
}

function registerClientFallback(app: express.Express) {
	const clientDistDir = path.resolve(process.cwd(), "dist", "public");
	const clientIndexPath = path.join(clientDistDir, "index.html");

	if (existsSync(clientIndexPath)) {
		app.use(express.static(clientDistDir));
		app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
			res.sendFile(clientIndexPath);
		});
		return;
	}

	app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
		res.status(404).type("text/plain").send(
			"Standalone SmartDeploy client assets are not present in this repository checkout.",
		);
	});
}

app.use((req, res, next) => {
	const start = Date.now();
	const path = req.path;
	let capturedJsonResponse: Record<string, unknown> | undefined;

	const originalResJson = res.json;
	res.json = (bodyJson, ...args) => {
		capturedJsonResponse = bodyJson;
		return originalResJson.apply(res, [bodyJson, ...args]);
	};

	res.on("finish", () => {
		const duration = Date.now() - start;
		if (path.startsWith("/api")) {
			let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
			if (capturedJsonResponse && process.env.NODE_ENV !== "production") {
				logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
			}

			log(logLine);
		}
	});

	next();
});

(async () => {
	await seedDatabase();
	await registerRoutes(httpServer, app);

	app.use(
		(
			err: Error & { status?: number; statusCode?: number },
			_req: Request,
			res: Response,
			next: NextFunction,
		) => {
			const status = err.status || err.statusCode || 500;
			const message = err.message || "Internal Server Error";

			log(`Internal Server Error: ${message}`, "error");

			if (res.headersSent) {
				return next(err);
			}

			const clientMessage =
				status >= 500 && process.env.NODE_ENV === "production"
					? "Internal Server Error"
					: message;
			return res.status(status).json({ message: clientMessage });
		},
	);

	// Register a non-API fallback only after API routes are mounted.
	// This repo no longer contains the original Vite/static helpers, so the
	// standalone server must not reference files that do not exist.
	registerClientFallback(app);

	const port = Number.parseInt(process.env.PORT || "5000", 10);
	httpServer.listen(
		{
			port,
			host: "0.0.0.0",
			reusePort: true,
		},
		() => {
			log(`serving on port ${port}`);
		},
	);

	function gracefulShutdown(signal: string) {
		log(`${signal} received – shutting down gracefully`);
		httpServer.close(() => {
			log("HTTP server closed");
			process.exit(0);
		});
		setTimeout(() => {
			log("Forceful shutdown after timeout", "error");
			process.exit(1);
		}, 10_000).unref();
	}

	process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
	process.on("SIGINT", () => gracefulShutdown("SIGINT"));
})();
