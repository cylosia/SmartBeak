import { createConsola, type ConsolaReporter, type LogObject } from "consola";

const jsonReporter: ConsolaReporter = {
	log(logObj: LogObject) {
		const entry = {
			level: logObj.type,
			timestamp: new Date().toISOString(),
			message: logObj.args
				.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
				.join(" "),
			...(logObj.tag ? { tag: logObj.tag } : {}),
		};
		const stream =
			logObj.level >= 2 ? process.stdout : process.stderr;
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
