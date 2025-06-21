import { Embedding, EmbeddingService } from './embeddings.js';
import { Document } from './document.js';

export interface SearchResult {
  document: Document;
  similarity: number;
}

export class VectorStore {
  private embeddings: Embedding[] = [];
  private embeddingService: EmbeddingService;

  constructor(embeddingService: EmbeddingService) {
    this.embeddingService = embeddingService;
  }

  async addDocuments(documents: Document[]): Promise<void> {
    const newEmbeddings = await this.embeddingService.embedDocuments(documents);
    this.embeddings.push(...newEmbeddings);
  }

  async addDocument(document: Document): Promise<void> {
    const embedding = await this.embeddingService.embedDocument(document);
    this.embeddings.push(embedding);
  }

  async search(query: string, topK: number = 5): Promise<SearchResult[]> {
    if (this.embeddings.length === 0) {
      return [];
    }

    const queryEmbedding = await this.embeddingService.embedText(query);
    
    const similarities = this.embeddings.map(embedding => ({
      document: embedding.document,
      similarity: this.embeddingService.cosineSimilarity(queryEmbedding, embedding.vector)
    }));

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  getDocumentCount(): number {
    return this.embeddings.length;
  }

  clear(): void {
    this.embeddings = [];
  }

  getAllDocuments(): Document[] {
    return this.embeddings.map(embedding => embedding.document);
  }
}