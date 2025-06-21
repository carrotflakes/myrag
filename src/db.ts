import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { Document } from './document.js';

export interface DocumentRow {
  id: string;
  content: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export class DatabaseService {
  private db: sqlite3.Database;
  private initialized = false;

  constructor(private dbPath: string = 'documents.db') {
    sqlite3.verbose();
    this.db = new sqlite3.Database(dbPath);
  }

  private async runQuery(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async getQuery(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  private async allQuery(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createIndexSQL = `
      CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at)
    `;

    await this.runQuery(createTableSQL);
    await this.runQuery(createIndexSQL);
    
    this.initialized = true;
  }

  async saveDocument(document: Document): Promise<void> {
    await this.initialize();
    
    const sql = `
      INSERT OR REPLACE INTO documents (id, content, metadata, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;
    
    const metadataJson = JSON.stringify(document.metadata || {});
    await this.runQuery(sql, [document.id, document.content, metadataJson]);
  }

  async saveDocuments(documents: Document[]): Promise<void> {
    await this.initialize();
    
    const sql = `
      INSERT OR REPLACE INTO documents (id, content, metadata, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        
        const stmt = this.db.prepare(sql);
        
        for (const doc of documents) {
          const metadataJson = JSON.stringify(doc.metadata || {});
          stmt.run([doc.id, doc.content, metadataJson]);
        }
        
        stmt.finalize((err) => {
          if (err) {
            this.db.run('ROLLBACK');
            reject(err);
            return;
          }
          
          this.db.run('COMMIT', (commitErr) => {
            if (commitErr) reject(commitErr);
            else resolve();
          });
        });
      });
    });
  }

  async getDocument(id: string): Promise<Document | null> {
    await this.initialize();
    
    const sql = 'SELECT * FROM documents WHERE id = ?';
    const row: DocumentRow = await this.getQuery(sql, [id]);
    
    if (!row) return null;
    
    return {
      id: row.id,
      content: row.content,
      metadata: JSON.parse(row.metadata)
    };
  }

  async getAllDocuments(): Promise<Document[]> {
    await this.initialize();
    
    const sql = 'SELECT * FROM documents ORDER BY created_at DESC';
    const rows: DocumentRow[] = await this.allQuery(sql);
    
    return rows.map(row => ({
      id: row.id,
      content: row.content,
      metadata: JSON.parse(row.metadata)
    }));
  }

  async searchDocuments(query: string, limit: number = 50): Promise<Document[]> {
    await this.initialize();
    
    const sql = `
      SELECT * FROM documents 
      WHERE content LIKE ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `;
    
    const rows: DocumentRow[] = await this.allQuery(sql, [`%${query}%`, limit]);
    
    return rows.map(row => ({
      id: row.id,
      content: row.content,
      metadata: JSON.parse(row.metadata)
    }));
  }

  async deleteDocument(id: string): Promise<void> {
    await this.initialize();
    
    const sql = 'DELETE FROM documents WHERE id = ?';
    await this.runQuery(sql, [id]);
  }

  async getDocumentCount(): Promise<number> {
    await this.initialize();
    
    const sql = 'SELECT COUNT(*) as count FROM documents';
    const row = await this.getQuery(sql);
    return row.count;
  }

  async clearAllDocuments(): Promise<void> {
    await this.initialize();
    
    const sql = 'DELETE FROM documents';
    await this.runQuery(sql);
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close(() => {
        resolve();
      });
    });
  }
}