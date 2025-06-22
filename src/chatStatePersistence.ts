import sqlite3 from 'sqlite3';
import { ChatState, ChatMessage } from './chat';
import logger from './logger';

export interface ChatSession {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

export class ChatStatePersistence {
  private db: sqlite3.Database;
  private initialized = false;

  constructor(dbPath: string = 'chat_sessions.db') {
    this.db = new sqlite3.Database(dbPath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Create sessions table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            message_count INTEGER DEFAULT 0
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create chat_sessions table', { error: err.message });
            return reject(err);
          }
        });

        // Create messages table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT,
            function_name TEXT,
            arguments TEXT,
            message_id TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            message_order INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES chat_sessions (id) ON DELETE CASCADE
          )
        `, (err: Error | null) => {
          if (err) {
            logger.error('Failed to create chat_messages table', { error: err.message });
            return reject(err);
          }
        });

        // Create index on session_id and message_order for efficient queries
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_messages_session_order 
          ON chat_messages (session_id, message_order)
        `, (err) => {
          if (err) {
            logger.error('Failed to create message index', { error: err.message });
            return reject(err);
          }
          
          this.initialized = true;
          logger.info('Chat state persistence initialized');
          resolve();
        });
      });
    });
  }

  async saveSession(sessionId: string, state: ChatState): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');

        // Insert or update session
        this.db.run(`
          INSERT OR REPLACE INTO chat_sessions (id, updated_at, message_count)
          VALUES (?, CURRENT_TIMESTAMP, ?)
        `, [sessionId, state.messages.length], (err) => {
          if (err) {
            this.db.run('ROLLBACK');
            logger.error('Failed to save chat session', { sessionId, error: err.message });
            return reject(err);
          }
        });

        // Delete existing messages for this session
        this.db.run(`
          DELETE FROM chat_messages WHERE session_id = ?
        `, [sessionId], (err) => {
          if (err) {
            this.db.run('ROLLBACK');
            logger.error('Failed to delete old messages', { sessionId, error: err.message });
            return reject(err);
          }
        });

        // Insert all messages
        const insertMessage = this.db.prepare(`
          INSERT INTO chat_messages (session_id, role, content, function_name, arguments, message_id, timestamp, message_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let insertCount = 0;
        let hasError = false;

        const finishTransaction = () => {
          insertMessage.finalize();
          if (hasError) {
            this.db.run('ROLLBACK');
            return;
          }
          
          this.db.run('COMMIT', (err) => {
            if (err) {
              logger.error('Failed to commit chat session', { sessionId, error: err.message });
              reject(err);
            } else {
              logger.info('Chat session saved successfully', { 
                sessionId, 
                messageCount: state.messages.length 
              });
              resolve();
            }
          });
        };

        if (state.messages.length === 0) {
          finishTransaction();
          return;
        }

        state.messages.forEach((message, index) => {
          const serializedMessage = this.serializeMessage(message);
          
          insertMessage.run(
            sessionId,
            serializedMessage.role,
            serializedMessage.content,
            serializedMessage.functionName,
            serializedMessage.arguments,
            serializedMessage.messageId,
            serializedMessage.timestamp.toISOString(),
            index,
            (err: Error | null) => {
              if (err && !hasError) {
                hasError = true;
                logger.error('Failed to insert chat message', { 
                  sessionId, 
                  messageIndex: index, 
                  error: err.message 
                });
                reject(err);
                return;
              }
              
              insertCount++;
              if (insertCount === state.messages.length) {
                finishTransaction();
              }
            }
          );
        });
      });
    });
  }

  async loadSession(sessionId: string): Promise<ChatState | null> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      // First check if session exists
      this.db.get(`
        SELECT id, message_count FROM chat_sessions WHERE id = ?
      `, [sessionId], (err, sessionRow: any) => {
        if (err) {
          logger.error('Failed to load chat session', { sessionId, error: err.message });
          return reject(err);
        }

        if (!sessionRow) {
          logger.info('Chat session not found', { sessionId });
          return resolve(null);
        }

        // Load messages
        this.db.all(`
          SELECT role, content, function_name, arguments, message_id, timestamp
          FROM chat_messages 
          WHERE session_id = ? 
          ORDER BY message_order ASC
        `, [sessionId], (err, rows: any[]) => {
          if (err) {
            logger.error('Failed to load chat messages', { sessionId, error: err.message });
            return reject(err);
          }

          try {
            const messages: ChatMessage[] = rows.map(row => this.deserializeMessage(row));
            
            const state: ChatState = {
              messages,
              previousResponseId: null // Reset response ID on load
            };

            logger.info('Chat session loaded successfully', { 
              sessionId, 
              messageCount: messages.length 
            });
            
            resolve(state);
          } catch (deserializeError) {
            logger.error('Failed to deserialize chat messages', { 
              sessionId, 
              error: deserializeError instanceof Error ? deserializeError.message : String(deserializeError)
            });
            reject(deserializeError);
          }
        });
      });
    });
  }

  async listSessions(): Promise<ChatSession[]> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT id, created_at, updated_at, message_count
        FROM chat_sessions 
        ORDER BY updated_at DESC
      `, [], (err, rows: any[]) => {
        if (err) {
          logger.error('Failed to list chat sessions', { error: err.message });
          return reject(err);
        }

        const sessions: ChatSession[] = rows.map(row => ({
          id: row.id,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          messageCount: row.message_count
        }));

        resolve(sessions);
      });
    });
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      this.db.run(`
        DELETE FROM chat_sessions WHERE id = ?
      `, [sessionId], function(err) {
        if (err) {
          logger.error('Failed to delete chat session', { sessionId, error: err.message });
          return reject(err);
        }

        const deleted = this.changes > 0;
        logger.info('Chat session deletion completed', { 
          sessionId, 
          deleted,
          changes: this.changes
        });
        
        resolve(deleted);
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          logger.error('Error closing chat database', { error: err.message });
        } else {
          logger.info('Chat database connection closed');
        }
        resolve();
      });
    });
  }

  private serializeMessage(message: ChatMessage): {
    role: string;
    content: string | null;
    functionName: string | null;
    arguments: string | null;
    messageId: string | null;
    timestamp: Date;
  } {
    const timestamp = message.timestamp || new Date();
    
    switch (message.role) {
      case 'user':
      case 'ai':
        return {
          role: message.role,
          content: message.content,
          functionName: null,
          arguments: null,
          messageId: null,
          timestamp
        };
      
      case 'toolCall':
        return {
          role: message.role,
          content: null,
          functionName: message.functionName,
          arguments: message.arguments,
          messageId: message.id,
          timestamp
        };
      
      case 'toolResponse':
        return {
          role: message.role,
          content: message.content,
          functionName: null,
          arguments: null,
          messageId: message.id,
          timestamp
        };
      
      case 'webSearchCall':
        return {
          role: message.role,
          content: null,
          functionName: null,
          arguments: null,
          messageId: null,
          timestamp
        };
      
      default:
        // Handle unknown message types by storing as JSON in content
        return {
          role: (message as any).role || 'unknown',
          content: JSON.stringify(message),
          functionName: null,
          arguments: null,
          messageId: null,
          timestamp
        };
    }
  }

  private deserializeMessage(row: any): ChatMessage {
    const timestamp = new Date(row.timestamp);
    
    switch (row.role) {
      case 'user':
        return {
          role: 'user',
          content: row.content,
          timestamp
        };
      
      case 'ai':
        return {
          role: 'ai',
          content: row.content,
          timestamp
        };
      
      case 'toolCall':
        return {
          role: 'toolCall',
          functionName: row.function_name,
          arguments: row.arguments,
          id: row.message_id || '',
          timestamp
        };
      
      case 'toolResponse':
        return {
          role: 'toolResponse',
          id: row.message_id || '',
          content: row.content,
          timestamp
        };
      
      case 'webSearchCall':
        return {
          role: 'webSearchCall',
          timestamp
        };
      
      default:
        // Try to parse as JSON for unknown types
        try {
          return JSON.parse(row.content);
        } catch {
          // Fallback to a basic message structure
          return {
            role: row.role as any,
            content: row.content,
            timestamp
          } as any;
        }
    }
  }
}

// Default instance
export const chatPersistence = new ChatStatePersistence();