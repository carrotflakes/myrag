import { InMemoryDocumentStore } from '../documentStore';
import z from 'zod';

const toolName = 'knowledge';

const schema = z.object({
  action: z.union([
    z.object({
      type: z.literal('search'),
      query: z.string(),
      topK: z.number(),
    }),
    z.object({
      type: z.literal('getChunk'),
      documentId: z.string(),
      chunkIndexStart: z.number(),
      chunkIndexEnd: z.number(),
    }),
    z.object({
      type: z.literal('add'),
      content: z.string(),
    }),
    z.object({
      type: z.literal('delete'),
      documentId: z.string()
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
- Chunk: A part of a document, used for efficient retrieval.

## Actions
- **search**: Search for relevant chunks based on a query.
- **getChunk**: Retrieve a specific chunk by document ID and index.
- **add**: Add a new document to the knowledge base.
- **delete**: Delete a document from the knowledge base.

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
                topK: { type: 'number', description: 'Number of top results to return (default: 3)' }
              },
              required: ['type', 'query', 'topK'],
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
                type: { type: 'string', enum: ['add'] },
                content: { type: 'string', description: 'Content of the document to add' },
              },
              required: ['type', 'content'],
              additionalProperties: false
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['delete'] },
                documentId: { type: 'string', description: 'ID of the document to delete' }
              },
              required: ['type', 'documentId'],
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

export function createKnowledgeExecutor(docStore: InMemoryDocumentStore) {
  return {
    [toolName]: async (args: string) => {
      const parsedArgs = schema.parse(JSON.parse(args));
      switch (parsedArgs.action.type) {
        case 'search': {
          const { query, topK } = parsedArgs.action;
          const results = await docStore.search(query, topK);
          return documentRender(docStore, results.map(item => ({
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
        case 'add': {
          const { content } = parsedArgs.action;
          const document = await docStore.addDocument(content);
          return `Document added with ID: ${document.id}`;
        }
        case 'delete': {
          const { documentId } = parsedArgs.action;
          const deleted = await docStore.deleteDocument(documentId);
          return deleted ? `Document with ID ${documentId} deleted.` : `Document with ID ${documentId} not found.`;
        }
        default:
          throw new Error('Unknown action');
      }
    }
  };
}

async function documentRender(docStore: InMemoryDocumentStore, chunks: { documentId: string, start: number, end: number }[]): Promise<string> {
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
      if (mergedChunks.length === 0 || mergedChunks[mergedChunks.length - 1].end < chunk.start) {
        mergedChunks.push({ start: chunk.start, end });
      } else {
        mergedChunks[mergedChunks.length - 1].end = Math.max(mergedChunks[mergedChunks.length - 1].end, end);
      }
    }

    parts.push(`<document id=${JSON.stringify(docId)}>\n`);

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
