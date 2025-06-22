import { EmbeddingService } from "./embeddings";

export interface Document {
  id: string;
  content: string;
  numberOfChunks: number;
  metadata?: Record<string, unknown>;
}

export interface Chunk {
  content: string;
  documentId: string;
  chunkIndex: number;
  range: {
    start: number;
    end: number;
  };
}

export interface DocumentStore {
  addDocument(content: string, metadata?: Record<string, unknown>): Promise<Document>;
  getDocument(id: string): Promise<Document | null>;
  getAllDocuments(): Promise<Document[]>;
  deleteDocument(id: string): Promise<boolean>;
  clearAllDocuments(): Promise<void>;
  search(query: string, topK?: number): Promise<{ chunk: Chunk; similarity: number }[]>;
  getChunkByIndex(documentId: string, chunkIndex: number): Promise<Chunk | null>;
  editChunk(documentId: string, chunkIndexStart: number, chunkIndexEnd: number, oldContent: string, newContent: string): Promise<Document | string>;
  // Persistence methods
  loadStoredDocumentsToVectorStore?(): Promise<void>;
  getVectorStoreDocumentCount?(): number;
  getStoredDocumentCount?(): Promise<number>;
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

    // Create chunks for the document
    const { chunks, ends } = this.chunker.chunk(content);
    for (let i = 0; i < chunks.length; i++) {
      const chunk: Chunk = {
        content: chunks[i],
        documentId: id,
        chunkIndex: i,
        range: {
          start: i === 0 ? 0 : ends[i - 1],
          end: ends[i]
        },
      };
      const embedding: number[] = await this.embeddingService.embedText(chunks[i]);
      this.chunks.push({ chunk, embedding });
    }

    const document: Document = { id, content, metadata, numberOfChunks: chunks.length };
    this.documents.set(id, document);

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

  async editChunk(documentId: string, chunkIndexStart: number, chunkIndexEnd: number, oldContent: string, newContent: string): Promise<Document | string> {
    const document = this.documents.get(documentId);
    if (!document) {
      return "Document not found";
    }

    const chunkStart = this.chunks.find(c => c.chunk.documentId === documentId && c.chunk.chunkIndex === chunkIndexStart);
    if (!chunkStart) {
      return "Chunk start not found";
    }
    const chunkEnd = this.chunks.find(c => c.chunk.documentId === documentId && c.chunk.chunkIndex === chunkIndexEnd);
    if (!chunkEnd) {
      return "Chunk end not found";
    }
    const text = document.content.slice(chunkStart.chunk.range.start, chunkEnd.chunk.range.end);

    const replacedText = text.replace(oldContent, newContent);
    if (replacedText === text) {
      return "Content is the same, no changes made";
    }

    const fullContent = document.content.slice(0, chunkStart.chunk.range.start) + replacedText + document.content.slice(chunkEnd.chunk.range.end);

    const newDocument = await this.addDocument(fullContent, document.metadata);
    await this.deleteDocument(documentId);

    return newDocument;
  }

  // Persistence methods (no-op for in-memory store)
  async loadStoredDocumentsToVectorStore(): Promise<void> {
    // No-op for in-memory store
  }

  getVectorStoreDocumentCount(): number {
    return this.documents.size;
  }

  async getStoredDocumentCount(): Promise<number> {
    return this.documents.size;
  }
}

export class TextChunker {
  constructor(
    private chunkSize: number = 500,
    private chunkOverlap: number = 100
  ) { }

  chunk(text: string) {
    const chunks: string[] = [];
    const ends: number[] = [];

    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      const end = Math.min(start + this.chunkSize, text.length);
      const chunkContent = text.slice(start, end);

      chunks.push(chunkContent);
      ends.push(end);

      if (end >= text.length) break;
      start = end - this.chunkOverlap;
      chunkIndex++;
    }

    return { chunks, ends };
  }
}
