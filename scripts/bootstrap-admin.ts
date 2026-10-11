import { readFileSync } from "node:fs";
import { bootstrapAdmin } from "@/lib/auth/bootstrap";
import { isMain, parseFlag, parseString, runCli } from "./lib/cli";

const HELP = `Usage: npm run bootstrap:admin -- --email <email> --password-stdin [--name <name>]

Creates the first ReadWise administrator, or promotes the matching existing user
when no administrator exists. The password is accepted only from standard input
and is never printed or included in command-line arguments.

Options:
  --email <email>      Administrator email address
  --name <name>        Optional display name
  --password-stdin     Read the password from standard input
  --help, -h           Show this help
`;

function passwordFromStdin(): string {
  return readFileSync(0, "utf8").replace(/\r?\n$/, "");
}

export async function bootstrapAdminMain(
  argv = process.argv.slice(2),
  io: {
    log?: (message: string) => void;
    error?: (message: string) => void;
    readPassword?: () => string;
  } = {},
): Promise<number> {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  if (parseFlag(argv, "--help", "-h")) {
    log(HELP.trimEnd());
    return 0;
  }

  const email = parseString(argv, "--email")?.trim() ?? "";
  if (!email || !parseFlag(argv, "--password-stdin")) {
    error("Both --email <email> and --password-stdin are required.");
    return 2;
  }

  const password = (io.readPassword ?? passwordFromStdin)();
  const user = await bootstrapAdmin({
    email,
    password,
    name: parseString(argv, "--name"),
  });
  log(JSON.stringify({ ok: true, userId: user.id }));
  return 0;
}

if (isMain(import.meta.url)) runCli(() => bootstrapAdminMain());
