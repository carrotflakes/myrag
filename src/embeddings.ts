import OpenAI from 'openai';
import { EmbeddingCache, FileEmbeddingCache } from './embeddingCache.js';

export class EmbeddingService {
  private openai: OpenAI;
  private cache: EmbeddingCache;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(cache?: EmbeddingCache) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.cache = cache || new FileEmbeddingCache();
  }

  async embedText(text: string): Promise<number[]> {
    // Check cache first
    const cachedEmbedding = await this.cache.get(text);
    if (cachedEmbedding) {
      this.cacheHits++;
      return cachedEmbedding;
    }

    try {
      this.cacheMisses++;
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text
      });

      const embedding = response.data[0].embedding;

      // Store in cache
      await this.cache.set(text, embedding);

      return embedding;
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${error}`);
    }
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  getCacheStats(): {
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0
    };
  }

  async getCacheInfo(): Promise<{
    size: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    cacheFile: string;
  }> {
    if (this.cache instanceof FileEmbeddingCache) {
      return await this.cache.getStats();
    }
    return {
      size: await this.cache.size(),
      oldestEntry: null,
      newestEntry: null,
      cacheFile: 'unknown'
    };
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}