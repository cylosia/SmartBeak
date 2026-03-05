import type { SendEmailHandler } from "../types";
import { send as consoleSend } from "./console";

function getProvider(): SendEmailHandler {
  const provider = process.env.MAIL_PROVIDER ?? "console";

  switch (provider) {
    case "resend":
      return require("./resend").send;
    case "postmark":
      return require("./postmark").send;
    case "nodemailer":
      return require("./nodemailer").send;
    case "mailgun":
      return require("./mailgun").send;
    case "plunk":
      return require("./plunk").send;
    case "console":
    default:
      return consoleSend;
  }
}

export const send: SendEmailHandler = async (params) => {
  const provider = getProvider();
  return provider(params);
};
