import crypto from "crypto";
import { injectable } from "tsyringe";

@injectable()
export class CryptoService {
  private readonly algorithm = "aes-256-gcm";
  private readonly ivLength = 12;
  private readonly saltLength = 16;
  private readonly keyLength = 32;

  private getEncryptionKey(): Buffer {
    const secret = process.env.SESSION_ENCRYPTION_KEY;
    if (!secret) {
      // Fallback/Default for development/testing only
      const devSecret = "development_only_secret_key_32_bytes_long_!";
      return crypto.createHash("sha256").update(devSecret).digest();
    }
    return crypto.createHash("sha256").update(secret).digest();
  }

  /**
   * Encrypts a string using AES-256-GCM.
   */
  public encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, this.getEncryptionKey(), iv);
    
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    
    const authTag = cipher.getAuthTag().toString("hex");
    
    // Format: iv:encrypted_data:auth_tag
    return `${iv.toString("hex")}:${encrypted}:${authTag}`;
  }

  /**
   * Decrypts a string using AES-256-GCM.
   */
  public decrypt(ciphertext: string): string {
    const parts = ciphertext.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted format. Expected iv:data:tag");
    }

    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], "hex");

    const decipher = crypto.createDecipheriv(this.algorithm, this.getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Generates a secure random UUID (v4).
   */
  public generateUuid(): string {
    return crypto.randomUUID();
  }
}
