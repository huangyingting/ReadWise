import { lookup, resolveMx } from "node:dns/promises";
import NodemailerImport from "nodemailer10";
import { isPublicMailAddress } from "./public-mail-address";
import type { DirectEmailDeliveryConfig } from "@/lib/runtime-config/account-admission";

type DefaultInterop<T> = { default: T };

function hasDefaultInterop<T>(
  value: T | DefaultInterop<T>,
): value is DefaultInterop<T> {
  return typeof value === "object" && value !== null && "default" in value;
}

const nodemailer = hasDefaultInterop(NodemailerImport)
  ? NodemailerImport.default
  : NodemailerImport;

export type DirectEmailDeliveryStatus = "sent" | "failed" | "unconfirmed";

export async function sendDirectEmail(
  message: { to: string; subject: string; text: string },
  config: DirectEmailDeliveryConfig,
): Promise<DirectEmailDeliveryStatus> {
  const senderDomain = config.from.split("@")[1];
  const recipientDomain = message.to.split("@")[1];
  if (
    !senderDomain ||
    !recipientDomain ||
    /[\r\n]/.test(config.from + message.to + message.subject)
  ) {
    throw new Error("Invalid direct email configuration or message.");
  }

  const exchanges = (await resolveMx(recipientDomain)).sort(
    (left, right) => left.priority - right.priority,
  );
  if (
    exchanges.length === 0 ||
    exchanges.some((exchange) => !exchange.exchange || exchange.exchange === ".")
  ) {
    return "failed";
  }

  const primaryMx = exchanges[0]!;
  const addresses = await lookup(primaryMx.exchange, { all: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicMailAddress(address))
  ) {
    return "failed";
  }

  const transport = nodemailer.createTransport({
    host: addresses[0]!.address,
    port: 25,
    secure: false,
    requireTLS: true,
    name: senderDomain,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    tls: {
      rejectUnauthorized: true,
      servername: primaryMx.exchange,
    },
    dkim: {
      domainName: senderDomain,
      keySelector: config.selector,
      privateKey: config.privateKey,
    },
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  try {
    const result = await transport.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      envelope: {
        from: config.from,
        to: [message.to],
      },
    });
    return result.accepted.length === 1 ? "sent" : "failed";
  } catch (error) {
    if (
      error instanceof Error &&
      "responseCode" in error &&
      typeof error.responseCode === "number" &&
      error.responseCode >= 400
    ) {
      return "failed";
    }
    if (
      error instanceof Error &&
      "code" in error &&
      ["ECONNECTION", "EDNS"].includes(String(error.code))
    ) {
      return "failed";
    }
    if (!(error instanceof Error)) throw error;
    return "unconfirmed";
  } finally {
    transport.close();
  }
}
