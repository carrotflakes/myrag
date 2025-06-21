# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

This project uses pnpm as the package manager:

- `pnpm build` - Compile TypeScript to JavaScript in `dist/` directory
- `pnpm dev` - Run development server with hot reload using tsx
- `pnpm start` - Run the compiled JavaScript from `dist/index.js`
- `pnpm clean` - Remove the `dist/` directory

The project is configured as an ES module (`"type": "module"` in package.json).

## Architecture Overview

This is a RAG (Retrieval-Augmented Generation) system built with TypeScript that combines document storage, embedding-based search, and LLM generation.

### Core Architecture

The system follows a layered architecture with clear separation of concerns:

**Document Layer** (`document.ts`, `db.ts`):
- `DocumentLoader`: Creates documents from text with metadata
- `TextChunker`: Splits documents into overlapping chunks for embedding
- `DatabaseService`: SQLite-based persistent storage for original documents

**Embedding & Search Layer** (`embeddings.ts`, `vectorstore.ts`, `cache.ts`):
- `EmbeddingService`: OpenAI text-embedding-3-small integration with caching
- `VectorStore`: In-memory vector search using cosine similarity
- `FileEmbeddingCache`: Base64-encoded embedding cache (77% compression ratio)

**Generation Layer** (`llm.ts`):
- `LLMService`: OpenAI Responses API integration (default: gpt-4.1-mini)

**Orchestration Layer** (`rag.ts`):
- `RAGSystem`: Main entry point that coordinates all components

### Key Design Decisions

**Hybrid Storage Strategy**:
- Original documents: Persistent SQLite storage (can survive restarts)
- Document chunks: In-memory vector store (fast search, rebuilt on startup)
- Embeddings: File-based cache with base64 compression

**OpenAI Integration**:
- Uses newer Responses API instead of Chat Completions API
- Embedding cache reduces API calls and costs
- Default model is gpt-4.1-mini (configurable)

**Data Flow**:
1. Documents → SQLite (persistence) + Chunking → VectorStore (search)
2. Query → Embedding → VectorStore search → Relevant chunks
3. Chunks + Query → LLM prompt → Generated response

### Environment Setup

Requires `OPENAI_API_KEY` environment variable. The system will create:
- `.cache/embeddings.json` - Base64-encoded embedding cache
- `documents.db` - SQLite database for document storage

### Usage Pattern

The main workflow involves:
1. Initialize `RAGSystem` with configuration
2. Add documents via `addDocument()` or `addDocuments()` 
3. Query the system via `query()` method
4. Optionally restore vector store from database with `loadStoredDocumentsToVectorStore()`