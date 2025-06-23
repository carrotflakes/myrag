import { DocumentStore } from '../documentStore';
import z from 'zod';

export const toolName = 'knowledge_base';

const schema = z.object({
  action: z.union([
    z.object({
      type: z.literal('search'),
      query: z.string(),
      topK: z.number(),
      skip: z.number(),
    }),
    z.object({
      type: z.literal('getChunk'),
      documentId: z.string(),
      chunkIndexStart: z.number(),
      chunkIndexEnd: z.number(),
    }),
    z.object({
      type: z.literal('addDocument'),
      content: z.string(),
    }),
    z.object({
      type: z.literal('deleteDocument'),
      documentId: z.string()
    }),
    z.object({
      type: z.literal('editChunk'),
      documentId: z.string(),
      chunkIndexStart: z.number(),
      chunkIndexEnd: z.number(),
      oldContent: z.string(),
      newContent: z.string(),
    }),
  ]),
});

export function createKnowledgeTool() {
  return {
    type: 'function' as const,
    name: toolName,
    description: `
Manage knowledge base with search, add, delete, and retrieve document chunks.

## Term Definitions
- Document: An unit of knowledge.
- Knowledge Base: A collection of documents.
- Chunk: A part of a document.

## Document Format
Documents are in Markdown format.
Documents should include headings for better organization and navigation.

## Documentation Guidelines
When adding, search existing documentation to avoid contradictions; consider editing instead of adding.

## Actions
You can perform the following actions on the knowledge base:

- **search**: Search for relevant chunks based on a query. Use skip parameter for pagination.
- **getChunk**: Retrieve a specific chunk by document ID and index.
- **addDocument**: Add a new document to the knowledge base.
- **deleteDocument**: Delete a document from the knowledge base.
- **editChunk**: Edit a specific chunk in a document.

## Tips
- The **omitted chunks** can be retrieved with **getChunk**.
`.trim(),
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          anyOf: [
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['search'] },
                query: { type: 'string', description: 'Search query to find relevant chunks' },
                topK: { type: 'number', description: 'Number of top results to return (default: 3)' },
                skip: { type: 'number', description: 'Number of results to skip (for pagination)' }
              },
              required: ['type', 'query', 'topK', 'skip'],
              additionalProperties: false
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['getChunk'] },
                documentId: { type: 'string', description: 'ID of the document' },
                chunkIndexStart: { type: 'number', description: 'Index of the start chunk' },
                chunkIndexEnd: { type: 'number', description: 'Index of the end chunk' }
              },
              required: ['type', 'documentId', 'chunkIndexStart', 'chunkIndexEnd'],
              additionalProperties: false
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['addDocument'] },
                content: { type: 'string', description: 'Content of the document to add' },
              },
              required: ['type', 'content'],
              additionalProperties: false
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['deleteDocument'] },
                documentId: { type: 'string', description: 'ID of the document to delete' }
              },
              required: ['type', 'documentId'],
              additionalProperties: false
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['editChunk'] },
                documentId: { type: 'string', description: 'ID of the document' },
                chunkIndexStart: { type: 'number', description: 'Starting chunk index to edit' },
                chunkIndexEnd: { type: 'number', description: 'Ending chunk index to edit' },
                oldContent: { type: 'string', description: 'Current content to be replaced' },
                newContent: { type: 'string', description: 'New content to replace with' }
              },
              required: ['type', 'documentId', 'chunkIndexStart', 'chunkIndexEnd', 'oldContent', 'newContent'],
              additionalProperties: false
            }
          ],
          additionalProperties: false,
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  }
}

export function createKnowledgeExecutor(docStore: DocumentStore) {
  return {
    [toolName]: async (args: string) => {
      const parsedArgs = schema.parse(JSON.parse(args));
      switch (parsedArgs.action.type) {
        case 'search': {
          const { query, topK, skip } = parsedArgs.action;
          const results = await docStore.search(query, topK + skip);
          const paginatedResults = results.slice(skip);
          return documentRender(docStore, paginatedResults.map(item => ({
            documentId: item.chunk.documentId,
            start: item.chunk.chunkIndex,
            end: item.chunk.chunkIndex
          })));
        }
        case 'getChunk': {
          const { documentId, chunkIndexStart, chunkIndexEnd } = parsedArgs.action;
          return documentRender(docStore, [{
            documentId,
            start: chunkIndexStart,
            end: chunkIndexEnd
          }]);
        }
        case 'addDocument': {
          const { content } = parsedArgs.action;
          const document = await docStore.addDocument(content);
          return `Document added with ID: ${document.id}`;
        }
        case 'deleteDocument': {
          const { documentId } = parsedArgs.action;
          const deleted = await docStore.deleteDocument(documentId);
          return deleted ? `Document with ID ${documentId} deleted.` : `Document with ID ${documentId} not found.`;
        }
        case 'editChunk': {
          const { documentId, chunkIndexStart, chunkIndexEnd, oldContent, newContent } = parsedArgs.action;
          const result = await docStore.editChunk(documentId, chunkIndexStart, chunkIndexEnd, oldContent, newContent);
          if (typeof result === 'string') {
            return `Failed to edit chunks ${chunkIndexStart}-${chunkIndexEnd} in document ${documentId}: ${result}`;
          } else {
            return `Successfully edited chunks ${chunkIndexStart}-${chunkIndexEnd}. New document ID: ${result.id}`;
          }
        }
        default:
          throw new Error('Unknown action');
      }
    }
  };
}

async function documentRender(docStore: DocumentStore, chunks: { documentId: string, start: number, end: number }[]): Promise<string> {
  const docIds = new Set(chunks.map(c => c.documentId));
  const parts: string[] = [];

  for (const docId of docIds) {
    const document = await docStore.getDocument(docId);
    if (!document) {
      parts.push(`<document id=${JSON.stringify(docId)}>\nDocument not found.\n</document>`);
      continue;
    }

    const mergedChunks: { start: number, end: number }[] = [];
    for (const chunk of chunks.filter(c => c.documentId === docId).sort((a, b) => a.start - b.start)) {
      const end = Math.min(chunk.end, document.numberOfChunks - 1);
      if (mergedChunks.length === 0 || mergedChunks[mergedChunks.length - 1].end + 1 < chunk.start) {
        mergedChunks.push({ start: chunk.start, end });
      } else {
        mergedChunks[mergedChunks.length - 1].end = Math.max(mergedChunks[mergedChunks.length - 1].end, end);
      }
    }

    parts.push(`<document id=${JSON.stringify(docId)} createdAt=${JSON.stringify(document.createdAt.toISOString())}>\n`);

    let lastChunkIndex = 0;
    for (const { start, end } of mergedChunks) {
      if (start > lastChunkIndex) {
        parts.push(`<chunk indexStart="${lastChunkIndex}" indexEnd="${start - 1}" omitted/>\n`);
      }

      const startChunk = await docStore.getChunkByIndex(docId, start);
      const endChunk = await docStore.getChunkByIndex(docId, end);
      if (!startChunk)
        throw new Error(`Chunk with index ${start} not found in document ${docId}.`);
      if (!endChunk)
        throw new Error(`Chunk with index ${end} not found in document ${docId}.`);
      const content = document.content.slice(startChunk.range.start, endChunk.range.end);
      parts.push(`<chunk indexStart="${start}" indexEnd="${end}">\n${content}\n</chunk>\n`);

      lastChunkIndex = end + 1;
    }

    if (mergedChunks[mergedChunks.length - 1].end < document.numberOfChunks - 1) {
      parts.push(`<chunk indexStart="${mergedChunks[mergedChunks.length - 1].end + 1}" indexEnd="${document.numberOfChunks - 1}" omitted/>\n`);
    }

    parts.push(`</document>\n`);
  }
  return parts.join('');
}
