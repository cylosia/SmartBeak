import { type ConsolaReporter, createConsola, type LogObject } from "consola";
import { redactSensitive } from "./redact";

const jsonReporter: ConsolaReporter = {
	log(logObj: LogObject) {
		const rawMessage = logObj.args
			.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
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
