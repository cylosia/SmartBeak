import { type ConsolaReporter, createConsola, type LogObject } from "consola";
import { redactSensitive } from "./redact";

function serializeLogArg(arg: unknown): string {
	if (typeof arg === "string") {
		return arg;
	}

	if (arg instanceof Error) {
		return JSON.stringify({
			name: arg.name,
			message: arg.message,
			stack: arg.stack,
		});
	}

	try {
		return JSON.stringify(arg, (_, value) =>
			typeof value === "bigint" ? value.toString() : value,
		);
	} catch {
		return "[Unserializable log argument]";
	}
}

const jsonReporter: ConsolaReporter = {
	log(logObj: LogObject) {
		const rawMessage = logObj.args
			.map((arg) => serializeLogArg(arg))
			.join(" ");
		const entry = {
			level: logObj.type,
			timestamp: new Date().toISOString(),
			message: redactSensitive(rawMessage),
			...(logObj.tag ? { tag: logObj.tag } : {}),
		};
		const stream = logObj.level >= 2 ? process.stdout : process.stderr;
		stream.write(`${JSON.stringify(entry)}\n`);
	},
};

const isProduction = process.env.NODE_ENV === "production";

export const logger = createConsola({
	formatOptions: {
		date: false,
	},
	reporters: isProduction ? [jsonReporter] : undefined,
});
