import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { AccountAdmissionError } from "./errors";

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const KEY_LENGTH = 64;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_PREFIX = "scrypt";

type EncodedPassword = {
  salt: Buffer;
  expected: Buffer;
  n: number;
  r: number;
  p: number;
};

export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

function encodePassword(
  salt: Buffer,
  hash: Buffer,
  n = SCRYPT_N,
  r = SCRYPT_R,
  p = SCRYPT_P,
): string {
  return [
    SCRYPT_PREFIX,
    String(n),
    String(r),
    String(p),
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

function parsePasswordHash(encoded: string): EncodedPassword | null {
  const [prefix, nRaw, rRaw, pRaw, saltRaw, hashRaw, extra] = encoded.split("$");
  if (
    prefix !== SCRYPT_PREFIX ||
    !nRaw ||
    !rRaw ||
    !pRaw ||
    !saltRaw ||
    !hashRaw ||
    extra !== undefined
  ) {
    return null;
  }

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (
    n !== SCRYPT_N ||
    r !== SCRYPT_R ||
    p !== SCRYPT_P
  ) {
    return null;
  }

  try {
    const salt = Buffer.from(saltRaw, "base64url");
    const expected = Buffer.from(hashRaw, "base64url");
    if (salt.length < 16 || expected.length !== KEY_LENGTH) return null;
    return { salt, expected, n, r, p };
  } catch {
    return null;
  }
}

async function derivePassword(
  password: string,
  salt: Buffer,
  params = { n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: params.n, r: params.r, p: params.p },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const policyError = passwordPolicyError(password);
  if (policyError) {
    throw new AccountAdmissionError(400, "invalid_password", policyError);
  }

  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt);
  return encodePassword(salt, hash);
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;

  const actual = await derivePassword(password, parsed.salt, parsed);
  return timingSafeEqual(actual, parsed.expected);
}
