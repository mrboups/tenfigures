import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

export function parseKeyHex(secret: string): Buffer {
  const hex = secret.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("KEY_ENCRYPTION_SECRET must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plain: string, keyHex: string): string {
  const key = parseKeyHex(keyHex);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(packed: string, keyHex: string): string {
  const key = parseKeyHex(keyHex);
  const buf = Buffer.from(packed, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Invalid ciphertext");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function passwordsMatch(input: string, expected: string): boolean {
  const a = Buffer.from(input, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    const pad = Buffer.alloc(32);
    timingSafeEqual(Buffer.concat([a, pad]).subarray(0, 32), pad);
    return false;
  }
  return timingSafeEqual(a, b);
}
