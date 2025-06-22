import { EmbeddingService } from "./embeddings";

export interface Document {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface Chunk {
  id: string;
  content: string;
  documentId: string;
  chunkIndex: number;
}

export interface DocumentStore {
  addDocument(content: string, metadata?: Record<string, unknown>): Promise<Document>;
  getDocument(id: string): Promise<Document | null>;
  getAllDocuments(): Promise<Document[]>;
  deleteDocument(id: string): Promise<boolean>;
  clearAllDocuments(): Promise<void>;
}

export class InMemoryDocumentStore implements DocumentStore {
  private chunker: TextChunker;
  private embeddingService: EmbeddingService;
  private documents: Map<string, Document> = new Map();
  private chunks: {
    chunk: Chunk,
    embedding: number[]
  }[] = [];

  constructor() {
    this.chunker = new TextChunker();
    this.embeddingService = new EmbeddingService();
  }

  async addDocument(content: string, metadata: Record<string, unknown> = {}): Promise<Document> {
    const id = crypto.randomUUID();
    const document: Document = { id, content, metadata };
    this.documents.set(id, document);

    // Create chunks for the document
    const chunks = this.chunker.chunk(content);
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `${id}_chunk_${i}`;
      const chunk: Chunk = {
        id: chunkId,
        content: chunks[i],
        documentId: id,
        chunkIndex: i
      };
      const embedding: number[] = await this.embeddingService.embedText(chunks[i]);
      this.chunks.push({ chunk, embedding });
    }

    return document;
  }

  async getDocument(id: string): Promise<Document | null> {
    return this.documents.get(id) ?? null;
  }

  async getAllDocuments(): Promise<Document[]> {
    return Array.from(this.documents.values());
  }

  async deleteDocument(id: string): Promise<boolean> {
    const deleted = this.documents.delete(id);
    if (deleted) {
      this.chunks = this.chunks.filter(c => c.chunk.documentId !== id);
    }
    return deleted;
  }

  async clearAllDocuments(): Promise<void> {
    this.documents.clear();
    this.chunks = [];
  }

  async getChunkByIndex(documentId: string, chunkIndex: number): Promise<Chunk | null> {
    const chunk = this.chunks.find(c => c.chunk.documentId === documentId && c.chunk.chunkIndex === chunkIndex);
    return chunk?.chunk ?? null;
  }

  async search(query: string, topK: number): Promise<{ chunk: Chunk; similarity: number }[]> {
    const queryEmbedding = await this.embeddingService.embedText(query);
    const similarities = this.chunks.map(({ chunk, embedding }) => {
      const similarity = this.embeddingService.cosineSimilarity(queryEmbedding, embedding);
      return { chunk, similarity };
    });

    // Sort by similarity and return the top K results
    return similarities.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
  }
}

export class TextChunker {
  constructor(
    private chunkSize: number = 500,
    private chunkOverlap: number = 100
  ) { }

  chunk(text: string): string[] {
    const chunks: string[] = [];

    if (text.length <= this.chunkSize) {
      return [text];
    }

    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      const end = Math.min(start + this.chunkSize, text.length);
      const chunkContent = text.slice(start, end);

      chunks.push(chunkContent);

      if (end >= text.length) break;
      start = end - this.chunkOverlap;
      chunkIndex++;
    }

    return chunks;
  }
}
