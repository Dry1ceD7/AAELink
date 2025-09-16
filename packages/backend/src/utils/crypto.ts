import { createHash, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// Hash password using scrypt
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}.${hash.toString('hex')}`;
}

// Verify password against hash
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split('.');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return keyBuffer.equals(derivedKey);
}

// Generate random token
export function generateToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

// Hash string with SHA-256
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
