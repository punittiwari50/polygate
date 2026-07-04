import fs from "fs";
import path from "path";

/**
 * Downloads SVGs, images, and other static assets to the local seed-data folder.
 */
export class AssetDownloader {
  /**
   * Resiliently downloads an asset from a URL and saves it.
   * If any failure occurs, it catches the error and returns null, allowing the caller to proceed.
   */
  public static async download(urlStr: string, destDir: string): Promise<string | null> {
    try {
      const parsedUrl = new URL(urlStr);
      let fileName = path.basename(parsedUrl.pathname);

      if (!fileName || fileName === "/" || !fileName.includes(".")) {
        // Fallback for URLs ending with query params or no extension
        const ext = this.guessExtensionFromUrl(urlStr);
        fileName = `asset_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
      }

      // Ensure destination directory exists
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const destPath = path.join(destDir, fileName);

      // Perform request
      const response = await fetch(urlStr);
      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(destPath, buffer);

      return fileName;
    } catch {
      // Return null on any error (resilient fallback)
      return null;
    }
  }

  private static guessExtensionFromUrl(url: string): string {
    const lower = url.toLowerCase();
    if (lower.includes(".svg")) return ".svg";
    if (lower.includes(".png")) return ".png";
    if (lower.includes(".jpg") || lower.includes(".jpeg")) return ".jpg";
    if (lower.includes(".webp")) return ".webp";
    if (lower.includes(".gif")) return ".gif";
    return ".bin";
  }
}
