import { DocumentLoader, TextChunker, Document } from './document.js';
import { EmbeddingService } from './embeddings.js';
import { VectorStore, SearchResult } from './vectorstore.js';
import { LLMService } from './llm.js';
import { EmbeddingCache } from './cache.js';
import { DatabaseService } from './db.js';

export interface RAGConfig {
  chunkSize?: number;
  chunkOverlap?: number;
  topK?: number;
  model?: string;
  temperature?: number;
  cacheDir?: string;
  cache?: EmbeddingCache;
  dbPath?: string;
}

export class RAGSystem {
  private vectorStore: VectorStore;
  private embeddingService: EmbeddingService;
  private llmService: LLMService;
  private chunker: TextChunker;
  private database: DatabaseService;
  private config: RAGConfig & {
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    model: string;
    temperature: number;
    cacheDir: string;
    dbPath: string;
  };

  constructor(apiKey?: string, config: RAGConfig = {}) {
    this.config = {
      chunkSize: config.chunkSize ?? 500,
      chunkOverlap: config.chunkOverlap ?? 100,
      topK: config.topK ?? 3,
      model: config.model ?? 'gpt-4.1-mini',
      temperature: config.temperature ?? 0,
      cacheDir: config.cacheDir ?? '.cache',
      dbPath: config.dbPath ?? 'documents.db',
      cache: config.cache
    };

    this.embeddingService = new EmbeddingService(apiKey, this.config.cache);
    this.vectorStore = new VectorStore(this.embeddingService);
    this.llmService = new LLMService(apiKey);
    this.chunker = new TextChunker(this.config.chunkSize, this.config.chunkOverlap);
    this.database = new DatabaseService(this.config.dbPath);
  }

  async addDocument(text: string, metadata?: Record<string, any>): Promise<void> {
    const document = DocumentLoader.fromText(text, metadata);
    
    // Save original document to database
    await this.database.saveDocument(document);
    
    // Create chunks and add to vector store (in-memory)
    const chunks = this.chunker.chunk(document);
    await this.vectorStore.addDocuments(chunks);
  }

  async addDocuments(documents: { text: string; metadata?: Record<string, any> }[]): Promise<void> {
    const allDocuments: Document[] = [];
    const allChunks: Document[] = [];
    
    for (const doc of documents) {
      const document = DocumentLoader.fromText(doc.text, doc.metadata);
      allDocuments.push(document);
      
      const chunks = this.chunker.chunk(document);
      allChunks.push(...chunks);
    }

    // Save original documents to database
    await this.database.saveDocuments(allDocuments);
    
    // Add chunks to vector store (in-memory)
    await this.vectorStore.addDocuments(allChunks);
  }

  async query(question: string): Promise<{
    answer: string;
    sources: SearchResult[];
  }> {
    const searchResults = await this.vectorStore.search(question, this.config.topK);
    
    if (searchResults.length === 0) {
      return {
        answer: 'Sorry, no relevant information was found.',
        sources: []
      };
    }

    const relevantDocuments = searchResults.map(result => result.document);
    const messages = this.llmService.createRAGPrompt(question, relevantDocuments);
    const answer = await this.llmService.generateResponse(
      messages.instructions,
      messages.input,
      this.config.model,
      this.config.temperature
    );

    return {
      answer,
      sources: searchResults
    };
  }

  getDocumentCount(): number {
    return this.vectorStore.getDocumentCount();
  }

  async getStoredDocumentCount(): Promise<number> {
    return await this.database.getDocumentCount();
  }

  async getAllStoredDocuments(): Promise<Document[]> {
    return await this.database.getAllDocuments();
  }

  async getStoredDocument(id: string): Promise<Document | null> {
    return await this.database.getDocument(id);
  }

  async loadStoredDocumentsToVectorStore(): Promise<void> {
    const documents = await this.database.getAllDocuments();
    const allChunks: Document[] = [];
    
    for (const doc of documents) {
      const chunks = this.chunker.chunk(doc);
      allChunks.push(...chunks);
    }
    
    await this.vectorStore.addDocuments(allChunks);
  }

  clear(): void {
    this.vectorStore.clear();
  }

  async clearStoredDocuments(): Promise<void> {
    await this.database.clearAllDocuments();
  }

  async close(): Promise<void> {
    await this.database.close();
  }

  getCacheStats(): {
    hits: number;
    misses: number;
    hitRate: number;
  } {
    return this.embeddingService.getCacheStats();
  }

  async getCacheInfo(): Promise<{
    size: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    cacheFile: string;
  }> {
    return await this.embeddingService.getCacheInfo();
  }

  async clearCache(): Promise<void> {
    await this.embeddingService.clearCache();
  }
}