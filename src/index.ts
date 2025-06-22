import 'dotenv/config';

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { ChatState, addUserMessage, processLlm, processTool, ChatMessage } from './chat';
import { createKnowledgeExecutor, createKnowledgeTool } from './tools/knowledge';
import { createDocumentStore } from './createDocumentStore';
import { DocumentStore } from './documentStore';
import logger from './logger';

interface AppContext {
  docStore: DocumentStore;
  instructions: string;
  tools: any[];
  toolExecutors: Record<string, any>;
}

function displayMessage(message: ChatMessage): void {
  if (message.role === 'ai') {
    console.log(`🤖 Assistant: ${message.content}`);
  } else if (message.role === 'toolCall') {
    console.log(`🔧 Tool Call: ${message.functionName}(${message.arguments})`);
  } else if (message.role === 'webSearchCall') {
    console.log(`🔍 Web Search Call`);
  } else if (message.role === 'toolResponse') {
    console.log(`🔧 Tool Result: ${message.content.slice(0, 200)}${message.content.length > 200 ? '...' : ''}`);
  }
}

function handleQuitCommand(): boolean {
  logger.info('User initiated shutdown');
  console.log('Goodbye!');
  return true;
}

function handleClearCommand(): ChatState {
  logger.info('Chat history cleared by user');
  console.log('Chat history cleared.\n');
  return {
    messages: [],
    previousResponseId: null
  };
}

async function handleLoadCommand(filename: string, docStore: DocumentStore): Promise<boolean> {
  logger.info('Document load requested', { filename });
  try {
    if (!fs.existsSync(filename)) {
      logger.warn('File not found', { filename });
      console.log(`File not found: ${filename}\n`);
      return false;
    }

    const content = fs.readFileSync(filename, 'utf8');
    const docId = path.basename(filename);

    await docStore.addDocument(content, {
      filename: filename,
      loadedAt: new Date().toISOString()
    });

    logger.info('Document loaded successfully', {
      filename,
      docId,
      contentLength: content.length
    });

    console.log(`Document loaded: ${filename} (ID: ${docId})\n`);
    return true;
  } catch (error) {
    logger.error('Error loading document', {
      filename,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error('Error loading document:', error instanceof Error ? error.message : error);
    console.log('');
    return false;
  }
}

async function processChatQuery(query: string, context: AppContext, state: ChatState): Promise<ChatState> {
  console.log('🤖 Processing...');
  logger.info('Processing user query', { query });

  state = addUserMessage(state, query);

  state = await processLlm(context.instructions, context.tools, state);

  const latestMessage = state.messages[state.messages.length - 1];
  displayMessage(latestMessage);

  while (true) {
    const newState = await processTool(context.toolExecutors, state);
    if (!newState) break;

    state = newState;

    const lastMessage = state.messages[state.messages.length - 1];
    displayMessage(lastMessage);

    state = await processLlm(context.instructions, context.tools, state);

    const latestMessage = state.messages[state.messages.length - 1];
    displayMessage(latestMessage);
  }

  logger.info('Chat processing completed', {
    finalMessageCount: state.messages.length
  });

  console.log(''); // Add blank line after completion
  return state;
}

// Handle user input and routing
async function handleUserInput(input: string, context: AppContext, state: ChatState, rl: readline.Interface): Promise<{ state: ChatState; shouldContinue: boolean }> {
  const query = input.trim();

  // Handle quit command
  if (query.toLowerCase() === 'quit' || query.toLowerCase() === 'exit') {
    handleQuitCommand();
    rl.close();
    return { state, shouldContinue: false };
  }

  // Handle clear command
  if (query.toLowerCase() === 'clear') {
    const newState = handleClearCommand();
    return { state: newState, shouldContinue: true };
  }

  // Handle load command
  if (query.toLowerCase().startsWith('load ')) {
    const filename = query.slice(5).trim();
    await handleLoadCommand(filename, context.docStore);
    return { state, shouldContinue: true };
  }

  // Handle empty query
  if (!query) {
    return { state, shouldContinue: true };
  }

  // Process chat query
  try {
    const newState = await processChatQuery(query, context, state);
    return { state: newState, shouldContinue: true };
  } catch (error) {
    logger.error('Error processing query', {
      query,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error('Error:', error instanceof Error ? error.message : error);
    console.log('');
    return { state, shouldContinue: true };
  }
}

async function main() {
  logger.info('Starting RAG System Interactive Chat UI');

  const docStore = await createDocumentStore();

  const instructions = `
You are a helpful assistant with access to a knowledge base.
Use the knowledge tool to search, add, and delete documents in the knowledge base.
When answering questions, first search for relevant documents.
The knowledge tool only returns relevant chunks of text, so you must use **getChunk** to retrieve full documents if needed.
If no relevant information is found, say "I don't know".
Always provide concise and accurate answers based on the knowledge base.

Special instructions:
- When the user says "remember this", automatically add the content they want you to remember to the knowledge base using the knowledge tool with action type "add".
- When the user says "forget this", delete the specified document from the knowledge base using the knowledge tool with action type "delete".
- When the user says "search for", use the web_search tool.
 `.trim();

  const searchContextSize = (process.env.SEARCH_CONTEXT_SIZE ?? "high") as "low" | "medium" | "high";

  const tools = [
    {
      type: "web_search_preview",
      search_context_size: searchContextSize,
    } as const,
    createKnowledgeTool(),
  ];
  const toolExecutors = {
    ...createKnowledgeExecutor(docStore),
  };

  const context: AppContext = {
    docStore,
    instructions,
    tools,
    toolExecutors
  };

  let state: ChatState = {
    messages: [],
    previousResponseId: null
  };

  logger.info('RAG System initialized', {
    toolsCount: tools.length,
    executorsCount: Object.keys(toolExecutors).length
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('🤖 Interactive Chat UI - RAG System');
  console.log('Type your questions or commands:');
  console.log('- "quit" or "exit" to exit');
  console.log('- "clear" to clear chat history');
  console.log('- "load <filename>" to load a document');
  console.log('');

  const askQuestion = () => {
    rl.question('You: ', async (input) => {
      const result = await handleUserInput(input, context, state, rl);
      state = result.state;

      if (result.shouldContinue) {
        askQuestion();
      }
    });
  };

  askQuestion();
}

main().catch(console.error);
