import * as fs from 'fs/promises';
import * as path from 'path';
import CryptoJS from 'crypto-js';

export interface EmbeddingCache {
  get(key: string): Promise<number[] | null>;
  set(key: string, value: number[]): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

export interface CacheEntry {
  embedding: number[] | string; // Can be array or base64 encoded string
  timestamp: number;
  hash: string;
  encoded?: boolean; // Flag to indicate if embedding is base64 encoded
}

export class FileEmbeddingCache implements EmbeddingCache {
  private cacheDir: string;
  private cacheFile: string;
  private cache: Map<string, CacheEntry> = new Map();
  private loaded = false;

  constructor(cacheDir: string = '.cache') {
    this.cacheDir = cacheDir;
    this.cacheFile = path.join(cacheDir, 'embeddings.json');
  }

  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      // Directory already exists or other error
    }
  }

  private async loadCache(): Promise<void> {
    if (this.loaded) return;

    try {
      await this.ensureCacheDir();
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const entries: Record<string, CacheEntry> = JSON.parse(data);

      this.cache = new Map(Object.entries(entries));
      this.loaded = true;
    } catch (error) {
      // Cache file doesn't exist or is corrupted, start with empty cache
      this.cache = new Map();
      this.loaded = true;
    }
  }

  private async saveCache(): Promise<void> {
    await this.ensureCacheDir();
    const entries = Object.fromEntries(this.cache.entries());
    await fs.writeFile(this.cacheFile, JSON.stringify(entries, null, 2));
  }

  private generateKey(text: string): string {
    return CryptoJS.SHA256(text).toString();
  }

  private encodeEmbedding(embedding: number[]): string {
    // Convert to Float32Array for memory efficiency
    const float32Array = new Float32Array(embedding);
    // Convert to base64
    const buffer = Buffer.from(float32Array.buffer);
    return buffer.toString('base64');
  }

  private decodeEmbedding(base64String: string): number[] {
    // Convert from base64
    const buffer = Buffer.from(base64String, 'base64');
    // Convert back to Float32Array
    const float32Array = new Float32Array(buffer.buffer);
    // Convert to regular array
    return Array.from(float32Array);
  }

  async get(text: string): Promise<number[] | null> {
    await this.loadCache();
    const key = this.generateKey(text);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Verify hash matches (for integrity check)
    if (entry.hash !== key) {
      this.cache.delete(key);
      return null;
    }

    // Decode embedding if it's base64 encoded
    if (entry.encoded && typeof entry.embedding === 'string') {
      return this.decodeEmbedding(entry.embedding);
    }

    return entry.embedding as number[];
  }

  async set(text: string, embedding: number[]): Promise<void> {
    await this.loadCache();
    const key = this.generateKey(text);

    const entry: CacheEntry = {
      embedding: this.encodeEmbedding(embedding),
      timestamp: Date.now(),
      hash: key,
      encoded: true
    };

    this.cache.set(key, entry);
    await this.saveCache();
  }

  async has(text: string): Promise<boolean> {
    await this.loadCache();
    const key = this.generateKey(text);
    return this.cache.has(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
    try {
      await fs.unlink(this.cacheFile);
    } catch (error) {
      // File doesn't exist, ignore
    }
  }

  async size(): Promise<number> {
    await this.loadCache();
    return this.cache.size;
  }

  async getStats(): Promise<{
    size: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    cacheFile: string;
  }> {
    await this.loadCache();

    let oldest: number | null = null;
    let newest: number | null = null;

    for (const entry of this.cache.values()) {
      if (oldest === null || entry.timestamp < oldest) {
        oldest = entry.timestamp;
      }
      if (newest === null || entry.timestamp > newest) {
        newest = entry.timestamp;
      }
    }

    return {
      size: this.cache.size,
      oldestEntry: oldest,
      newestEntry: newest,
      cacheFile: this.cacheFile
    };
  }
}