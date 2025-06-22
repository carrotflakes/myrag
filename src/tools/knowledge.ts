import { InMemoryDocumentStore } from '../documentStore';
import z from 'zod';

const toolName = 'knowledge';

const schema = z.object({
  action: z.union([
    z.object({
      type: z.literal('search'),
      query: z.string(),
      topK: z.number().default(3)
    }),
    z.object({
      type: z.literal('getChunk'),
      documentId: z.string(),
      chunkIndex: z.number(),
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
    description: 'Manage knowledge base with search, add, and delete operations.',
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
                query: { type: 'string', description: 'Search query to find relevant documents' },
                topK: { type: 'number', description: 'Number of top results to return (default: 3)' }
              },
              required: ['type', 'query', 'topK'],
              additionalProperties: false
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['getChunk'] },
                documentId: { type: 'string', description: 'ID of the document to retrieve' },
                chunkIndex: { type: 'number', description: 'Index of the chunk to retrieve' }
              },
              required: ['type', 'documentId', 'chunkIndex'],
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
          return results.map(item => `<chunk id=${JSON.stringify(item.chunk.id)} docId=${JSON.stringify(item.chunk.documentId)} chunkIndex=${item.chunk.chunkIndex}>\n${item.chunk.content}\n</chunk>`).join('\n');
        }
        case 'getChunk': {
          const { documentId, chunkIndex } = parsedArgs.action;
          const chunk = await docStore.getChunkByIndex(documentId, chunkIndex);
          if (!chunk) {
            return `Chunk with index ${chunkIndex} not found in document ${documentId}.`;
          }
          return `<chunk id=${JSON.stringify(chunk.id)} docId=${JSON.stringify(chunk.documentId)} chunkIndex=${chunk.chunkIndex}>\n${chunk.content}\n</chunk>`;
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
