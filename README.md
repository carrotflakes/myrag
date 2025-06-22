# MyRAG

Personal RAG (Retrieval-Augmented Generation) system with interactive chat interface.

## Features

- Document management with SQLite persistence
- Vector search using OpenAI embeddings
- Interactive chat with session management
- Automatic chat history compression
- Tool-calling RAG architecture
- MCP server support

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env to set OPENAI_API_KEY
```

## Usage

```bash
pnpm dev
```

## Commands

- `load <file>` - Add document to knowledge base
- `save [id]` - Save current session
- `session <id>` - Load session
- `sessions` - List sessions
- `clear` - Clear chat history
- `quit` - Exit

## Architecture

- **Documents**: SQLite + in-memory vector store
- **Chat**: Auto-saved sessions with compression
- **Embeddings**: OpenAI API with file-based cache
- **RAG**: Dynamic tool-calling instead of pre-retrieval

## Environment

- `OPENAI_API_KEY` - Required
- `SEARCH_CONTEXT_SIZE` - low/medium/high
- `LOG_LEVEL` - debug/info/warn/error

## Copyright

Copyright (c) 2025 carrotflakes
