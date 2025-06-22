# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

This project uses pnpm as the package manager:

- `pnpm build` - Compile TypeScript to JavaScript in `dist/` directory
- `pnpm dev` - Run interactive chat UI with hot reload using tsx
- `pnpm start` - Run the compiled JavaScript from `dist/index.js`
- `pnpm clean` - Remove the `dist/` directory

The project is configured as an ES module (`"type": "module"` in package.json).

## Architecture Overview

This is a modern Tool-Calling RAG (Retrieval-Augmented Generation) system built with TypeScript that provides an interactive chat interface with knowledge management capabilities.

### Core Architecture

The system follows a layered architecture optimized for interactive chat experiences:

**Document Management Layer** (`src/documentStore.ts`, `src/sqliteDocumentStore.ts`, `src/createDocumentStore.ts`):
- `SQLiteDocumentStore`: Persistent SQLite-based document storage (default)
- `InMemoryDocumentStore`: Alternative in-memory storage for development/testing
- `TextChunker`: Splits documents into 500-character chunks with 100-character overlap
- `createDocumentStore()`: Factory function with automatic persistence detection and source file loading
- Hybrid storage: SQLite for documents, memory for vector embeddings

**Embedding & Search Layer** (`src/embeddings.ts`, `src/embeddingCache.ts`):
- `EmbeddingService`: OpenAI text-embedding-3-small integration
- `FileEmbeddingCache`: Sophisticated caching with base64 compression (77% space savings)
- Cosine similarity-based vector search with configurable top-K results
- SHA256 hashing and integrity checks for cache reliability

**Chat & Tool-Calling Layer** (`src/chat.ts`):
- Uses OpenAI Responses API (not Chat Completions API) with `gpt-4.1-mini`
- Automatic tool orchestration with iterative processing
- State management for conversation history and tool interactions
- Temperature 0 for consistent responses

**Tools Layer** (`src/tools/`):
- `knowledge.ts`: Comprehensive knowledge management with search, add, delete, and chunk retrieval
- Tool response formatting with XML-like structure for clear source attribution
- Zod schema validation for robust parameter handling

**Infrastructure Layer** (`src/logger.ts`, `src/index.ts`):
- Winston-based logging with file rotation, structured JSON format
- Interactive CLI with readline interface
- Command processing: chat, file loading, history management

### Key Design Decisions

**Tool-Calling RAG Architecture**:
- LLM dynamically decides when and how to search documents using available tools
- More contextual and flexible than traditional RAG approaches
- Supports complex multi-step reasoning with tool chaining

**Hybrid Persistence Strategy**:
- Documents: Persistent SQLite storage (survives restarts)
- Vector embeddings: In-memory for fast search, automatically restored from database
- Embedding cache: File-based persistence for API cost optimization
- Smart initialization: Existing documents auto-loaded, source files processed only if database is empty

**Interactive Chat Experience**:
- Real-time chat interface with command support
- File loading: `load <filename>` to add documents during conversation
- History management: `clear` to reset conversation state
- Graceful error handling and user feedback

**Automatic Content Loading**:
- All `.md` files in `/source` directory are automatically loaded at startup
- Rich metadata tracking: filename, load time, content size
- Comprehensive logging of document loading process

### Environment Setup

Requires `OPENAI_API_KEY` environment variable. The system will create:
- `documents.db` - SQLite database for persistent document storage
- `logs/combined.log` - All application logs with rotation (5MB, 5 files)
- `logs/error.log` - Error-only logs
- `.cache/embeddings.json` - Base64-encoded embedding cache

Optional environment variables:
- `LOG_LEVEL` - Logging level (default: 'info')
- `NODE_ENV` - Set to 'production' to disable console logging

### Usage Patterns

**Interactive Chat**:
1. Run `pnpm dev` to start the interactive chat interface
2. Ask questions - the system will automatically search relevant documents
3. Use `load <filename>` to add new documents during conversation
4. Use `clear` to reset conversation history
5. Use `quit` or `exit` to terminate

**Document Management**:
- Place markdown files in `/source` directory for initial automatic loading
- Documents persist across restarts via SQLite database
- Runtime document addition via CLI `load <filename>` command
- Vector embeddings automatically rebuilt from database on startup

### Tool Response Format

Tools return structured responses with clear source attribution:
```
<document id="document-uuid">
<chunk indexStart="0" indexEnd="2">
Document content here...
</chunk>
<chunk indexStart="5" indexEnd="7" omitted/>
</document>
```

This format ensures traceability from AI responses back to source documents, with support for chunk ranges and omitted content indicators.