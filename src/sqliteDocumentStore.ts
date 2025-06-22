import Database from 'sqlite3';
import { EmbeddingService } from './embeddings';
import { Document, Chunk, DocumentStore, TextChunker } from './documentStore';
import logger from './logger';

export class SQLiteDocumentStore implements DocumentStore {
  private db: Database.Database;
  private chunker: TextChunker;
  private embeddingService: EmbeddingService;
  private chunks: { chunk: Chunk; embedding: number[] }[] = [];

  constructor(dbPath: string = 'documents.db') {
    this.db = new Database.Database(dbPath);
    this.chunker = new TextChunker();
    this.embeddingService = new EmbeddingService();

    this.initializeDatabase();
    logger.info('SQLite document store initialized', { dbPath });
  }

  private initializeDatabase(): void {
    this.db.serialize(() => {
      // Create documents table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          numberOfChunks INTEGER NOT NULL,
          metadata TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS chunks (
          documentId TEXT NOT NULL,
          chunkIndex INTEGER NOT NULL,
          content TEXT NOT NULL,
          rangeStart INTEGER NOT NULL,
          rangeEnd INTEGER NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (documentId, chunkIndex),
          FOREIGN KEY (documentId) REFERENCES documents (id) ON DELETE CASCADE
        )
      `);

      // Create indexes for better performance  
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks (documentId)`);
    });
  }

  async addDocument(content: string, metadata: Record<string, unknown> = {}): Promise<Document> {
    const id = crypto.randomUUID();
    const metadataJson = JSON.stringify(metadata);

    // Create chunks for the document
    const { chunks, ends } = this.chunker.chunk(content);
    const chunkObjects: Chunk[] = [];

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
      chunkObjects.push(chunk);

      // Generate embedding and store in memory
      const embedding: number[] = await this.embeddingService.embedText(chunks[i]);
      this.chunks.push({ chunk, embedding });
    }

    const document: Document = {
      id,
      content,
      metadata,
      numberOfChunks: chunks.length
    };

    // Store in database
    await this.runAsync(
      'INSERT INTO documents (id, content, numberOfChunks, metadata) VALUES (?, ?, ?, ?)',
      [id, content, chunks.length, metadataJson]
    );

    // Store chunks in database
    for (const chunk of chunkObjects) {
      await this.runAsync(
        'INSERT INTO chunks (documentId, chunkIndex, content, rangeStart, rangeEnd) VALUES (?, ?, ?, ?, ?)',
        [chunk.documentId, chunk.chunkIndex, chunk.content, chunk.range.start, chunk.range.end]
      );
    }

    logger.info('Document added to SQLite store', {
      documentId: id,
      chunksCount: chunks.length,
      contentLength: content.length
    });

    return document;
  }

  async getDocument(id: string): Promise<Document | null> {
    try {
      const row = await this.getAsync(
        'SELECT id, content, numberOfChunks, metadata FROM documents WHERE id = ?',
        [id]
      ) as any;

      if (!row) return null;

      return {
        id: row.id,
        content: row.content,
        numberOfChunks: row.numberOfChunks,
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      };
    } catch (error) {
      logger.error('Error getting document from SQLite', { id, error });
      return null;
    }
  }

  async getAllDocuments(): Promise<Document[]> {
    try {
      const rows = await this.allAsync(
        'SELECT id, content, numberOfChunks, metadata FROM documents ORDER BY createdAt DESC'
      ) as any[];

      return rows.map(row => ({
        id: row.id,
        content: row.content,
        numberOfChunks: row.numberOfChunks,
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      }));
    } catch (error) {
      logger.error('Error getting all documents from SQLite', { error });
      return [];
    }
  }

  async deleteDocument(id: string): Promise<boolean> {
    try {
      // Remove from in-memory chunks
      this.chunks = this.chunks.filter(item => item.chunk.documentId !== id);

      // Remove from database (chunks will be deleted by CASCADE)
      const result = await this.runAsync('DELETE FROM documents WHERE id = ?', [id]);

      const deleted = (result as any).changes > 0;
      if (deleted) {
        logger.info('Document deleted from SQLite store', { documentId: id });
      }

      return deleted;
    } catch (error) {
      logger.error('Error deleting document from SQLite', { id, error });
      return false;
    }
  }

  async clearAllDocuments(): Promise<void> {
    try {
      this.chunks = [];
      await this.runAsync('DELETE FROM documents');
      await this.runAsync('DELETE FROM chunks');
      logger.info('All documents cleared from SQLite store');
    } catch (error) {
      logger.error('Error clearing documents from SQLite', { error });
      throw error;
    }
  }

  async search(query: string, topK: number = 5): Promise<{ chunk: Chunk; similarity: number }[]> {
    const queryEmbedding = await this.embeddingService.embedText(query);

    const results = this.chunks.map(item => ({
      chunk: item.chunk,
      similarity: this.cosineSimilarity(queryEmbedding, item.embedding)
    }));

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  async getChunkByIndex(documentId: string, chunkIndex: number): Promise<Chunk | null> {
    try {
      const row = await this.getAsync(
        'SELECT documentId, chunkIndex, content, rangeStart, rangeEnd FROM chunks WHERE documentId = ? AND chunkIndex = ?',
        [documentId, chunkIndex]
      ) as any;

      if (!row) return null;

      return {
        content: row.content,
        documentId: row.documentId,
        chunkIndex: row.chunkIndex,
        range: {
          start: row.rangeStart,
          end: row.rangeEnd
        }
      };
    } catch (error) {
      logger.error('Error getting chunk by index from SQLite', { documentId, chunkIndex, error });
      return null;
    }
  }

  // Load stored documents back into memory for vector search
  async loadStoredDocumentsToVectorStore(): Promise<void> {
    try {
      logger.info('Loading stored documents into vector store');

      // Clear existing in-memory chunks
      this.chunks = [];

      // Get all chunks from database
      const rows = await this.allAsync(
        'SELECT documentId, chunkIndex, content, rangeStart, rangeEnd FROM chunks ORDER BY documentId, chunkIndex'
      ) as any[];

      // Generate embeddings for all chunks
      for (const row of rows) {
        const chunk: Chunk = {
          content: row.content,
          documentId: row.documentId,
          chunkIndex: row.chunkIndex,
          range: {
            start: row.rangeStart,
            end: row.rangeEnd
          }
        };

        const embedding = await this.embeddingService.embedText(chunk.content);
        this.chunks.push({ chunk, embedding });
      }

      logger.info('Loaded documents into vector store', {
        chunksCount: this.chunks.length
      });
    } catch (error) {
      logger.error('Error loading stored documents to vector store', { error });
      throw error;
    }
  }

  getVectorStoreDocumentCount(): number {
    const documentIds = new Set(this.chunks.map(item => item.chunk.documentId));
    return documentIds.size;
  }

  async getStoredDocumentCount(): Promise<number> {
    try {
      const row = await this.getAsync('SELECT COUNT(*) as count FROM documents') as any;
      return row.count;
    } catch (error) {
      logger.error('Error getting stored document count', { error });
      return 0;
    }
  }

  async editChunk(documentId: string, chunkIndexStart: number, chunkIndexEnd: number, oldContent: string, newContent: string): Promise<Document | string> {
    try {
      const document = await this.getDocument(documentId);
      if (!document) {
        return "Document not found";
      }

      // Get the chunks to edit
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

      logger.info('Document chunk edited successfully', {
        oldDocumentId: documentId,
        newDocumentId: newDocument.id,
        chunkIndexStart,
        chunkIndexEnd,
        contentLengthChange: newContent.length - oldContent.length
      });

      return newDocument;
    } catch (error) {
      logger.error('Error editing chunk in SQLite', {
        documentId,
        chunkIndexStart,
        chunkIndexEnd,
        error: error instanceof Error ? error.message : String(error)
      });
      return "Error editing chunk: " + (error instanceof Error ? error.message : String(error));
    }
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          logger.error('Error closing SQLite database', { error: err.message });
          reject(err);
        } else {
          logger.info('SQLite database closed');
          resolve();
        }
      });
    });
  }

  // Helper methods for promisifying SQLite methods
  private runAsync(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  private getAsync(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  private allAsync(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }
}