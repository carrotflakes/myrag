import { InMemoryDocumentStore } from '../documentStore';

const toolName = 'search_documents';

export function createSearchDocumentsTool() {
  return {
    type: 'function' as const,
    name: toolName,
    description: 'Search for relevant documents in the knowledge base',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find relevant documents'
        },
        topK: {
          type: 'number',
          description: 'Number of top results to return (default: 3)',
          default: 3
        }
      },
      required: ['query', 'topK'],
      additionalProperties: false
    }
  };
}

export function createSearchDocumentsExecutor(docStore: InMemoryDocumentStore) {
  return {
    [toolName]: async (args: string) => {
      const parsedArgs = JSON.parse(args);
      const res = await docStore.search(parsedArgs.query, parsedArgs.topK);
      return res.map(item => `<chunk docId=${JSON.stringify(item.chunk.documentId)} chunkIndex=${item.chunk.chunkIndex}>\n${item.chunk.content}\n</chunk>`).join('\n');
    }
  };
}
