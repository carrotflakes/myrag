import 'dotenv/config';

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { addUserMessage, ChatMessage, ChatState, processLlm, processTool, Tool, ToolExecutor } from './chat';
import { defaultCompressor } from './chatCompression';
import { chatPersistence } from './chatStatePersistence';
import { createDocumentStore } from './createDocumentStore';
import { DocumentStore } from './documentStore';
import logger from './logger';
import { createKnowledgeExecutor, createKnowledgeTool, toolName as knowledgeToolName } from './tools/knowledge';

interface AppContext {
  docStore: DocumentStore;
  instructions: string;
  tools: Tool[];
  toolExecutors: Record<string, ToolExecutor>;
  currentSessionId: string;
}

function displayMessage(message: ChatMessage): void {
  if (message.role === 'ai') {
    console.log(`🌝 AI: ${message.content}`);
  } else if (message.role === 'toolCall') {
    console.log(`🔧 Tool Call: ${message.functionName}(${message.arguments})`);
  } else if (message.role === 'webSearchCall') {
    console.log(`🔍 Web Search Call`);
  } else if (message.role === 'toolResponse') {
    console.log(`🔧 Tool Result: ${message.content.slice(0, 200)}${message.content.length > 200 ? '...' : ''}`);
  }
}

async function handleQuitCommand(context: AppContext, state: ChatState): Promise<boolean> {
  logger.info('User initiated shutdown');

  try {
    // Save session before quitting
    await chatPersistence.saveSession(context.currentSessionId, state);
    logger.info('Session saved before shutdown', {
      sessionId: context.currentSessionId,
      messageCount: state.messages.length
    });
  } catch (error) {
    logger.error('Failed to save session before shutdown', {
      sessionId: context.currentSessionId,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Close persistence connection
  await chatPersistence.close();

  console.log('Goodbye!');
  return true;
}

async function handleClearCommand(context: AppContext): Promise<ChatState> {
  logger.info('Chat history cleared by user');
  console.log('Chat history cleared.\n');

  const newState: ChatState = {
    messages: [],
    previousResponseId: null
  };

  // Auto-save the cleared state
  try {
    await chatPersistence.saveSession(context.currentSessionId, newState);
    logger.info('Cleared session saved', { sessionId: context.currentSessionId });
  } catch (error) {
    logger.error('Failed to save cleared session', {
      sessionId: context.currentSessionId,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return newState;
}

async function handleCompressCommand(state: ChatState): Promise<{ newState: ChatState; stats: string }> {
  logger.info('Manual compression requested');
  console.log('📦 Compressing chat history...');

  try {
    const result = await defaultCompressor.compressHistory(state);
    const stats = defaultCompressor.getCompressionStats(result);

    logger.info('Manual compression completed', { stats });
    console.log(`📦 ${stats}\n`);

    return {
      newState: result.compressedState,
      stats
    };
  } catch (error) {
    logger.error('Manual compression failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    console.error('⚠️ Compression failed:', error instanceof Error ? error.message : error);
    console.log('');

    return {
      newState: state,
      stats: 'Compression failed'
    };
  }
}

async function handleSaveSessionCommand(sessionId: string, state: ChatState): Promise<boolean> {
  logger.info('Session save requested', { sessionId });
  try {
    await chatPersistence.saveSession(sessionId, state);
    console.log(`Session saved: ${sessionId}\n`);
    return true;
  } catch (error) {
    logger.error('Error saving session', {
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error('Error saving session:', error instanceof Error ? error.message : error);
    console.log('');
    return false;
  }
}

async function handleLoadSessionCommand(sessionId: string): Promise<ChatState | null> {
  logger.info('Session load requested', { sessionId });
  try {
    const state = await chatPersistence.loadSession(sessionId);
    if (state) {
      console.log(`Session loaded: ${sessionId} (${state.messages.length} messages)\n`);
    } else {
      console.log(`Session not found: ${sessionId}\n`);
    }
    return state;
  } catch (error) {
    logger.error('Error loading session', {
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error('Error loading session:', error instanceof Error ? error.message : error);
    console.log('');
    return null;
  }
}

async function handleListSessionsCommand(): Promise<void> {
  logger.info('Session list requested');
  try {
    const sessions = await chatPersistence.listSessions();
    if (sessions.length === 0) {
      console.log('No saved sessions found.\n');
      return;
    }

    console.log('Saved sessions:');
    sessions.forEach(session => {
      const updatedAt = session.updatedAt.toLocaleString();
      console.log(`- ${session.id} (${session.messageCount} messages, updated: ${updatedAt})`);
    });
    console.log('');
  } catch (error) {
    logger.error('Error listing sessions', {
      error: error instanceof Error ? error.message : String(error)
    });
    console.error('Error listing sessions:', error instanceof Error ? error.message : error);
    console.log('');
  }
}

async function handleDeleteSessionCommand(sessionId: string): Promise<boolean> {
  logger.info('Session deletion requested', { sessionId });
  try {
    const deleted = await chatPersistence.deleteSession(sessionId);
    if (deleted) {
      console.log(`Session deleted: ${sessionId}\n`);
    } else {
      console.log(`Session not found: ${sessionId}\n`);
    }
    return deleted;
  } catch (error) {
    logger.error('Error deleting session', {
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error('Error deleting session:', error instanceof Error ? error.message : error);
    console.log('');
    return false;
  }
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
  console.log('🌝 Processing...');
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

  // Check if compression is needed after processing
  if (defaultCompressor.shouldCompress(state)) {
    console.log('📦 Compressing chat history...');
    logger.info('Triggering automatic chat compression', {
      messageCount: state.messages.length
    });

    try {
      const result = await defaultCompressor.compressHistory(state);
      state = result.compressedState;

      const stats = defaultCompressor.getCompressionStats(result);
      console.log(`📦 ${stats}`);
      logger.info('Chat compression completed', { stats });
    } catch (error) {
      logger.error('Chat compression failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      console.log('⚠️ Chat compression failed, continuing with full history');
    }
  }

  // Auto-save session after processing
  try {
    await chatPersistence.saveSession(context.currentSessionId, state);
    logger.info('Session auto-saved', {
      sessionId: context.currentSessionId,
      messageCount: state.messages.length
    });
  } catch (error) {
    logger.error('Failed to auto-save session', {
      sessionId: context.currentSessionId,
      error: error instanceof Error ? error.message : String(error)
    });
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
    await handleQuitCommand(context, state);
    rl.close();
    return { state, shouldContinue: false };
  }

  // Handle clear command
  if (query.toLowerCase() === 'clear') {
    const newState = await handleClearCommand(context);
    return { state: newState, shouldContinue: true };
  }

  // Handle compress command
  if (query.toLowerCase() === 'compress') {
    const result = await handleCompressCommand(state);
    return { state: result.newState, shouldContinue: true };
  }

  // Handle load command
  if (query.toLowerCase().startsWith('load ')) {
    const filename = query.slice(5).trim();
    await handleLoadCommand(filename, context.docStore);
    return { state, shouldContinue: true };
  }

  // Handle save session command
  if (query.toLowerCase().startsWith('save ')) {
    const sessionId = query.slice(5).trim() || context.currentSessionId;
    await handleSaveSessionCommand(sessionId, state);
    return { state, shouldContinue: true };
  }

  // Handle load session command
  if (query.toLowerCase().startsWith('session ')) {
    const sessionId = query.slice(8).trim();
    const loadedState = await handleLoadSessionCommand(sessionId);
    if (loadedState) {
      return { state: loadedState, shouldContinue: true };
    }
    return { state, shouldContinue: true };
  }

  // Handle list sessions command
  if (query.toLowerCase() === 'sessions') {
    await handleListSessionsCommand();
    return { state, shouldContinue: true };
  }

  // Handle delete session command
  if (query.toLowerCase().startsWith('delete ')) {
    const sessionId = query.slice(7).trim();
    await handleDeleteSessionCommand(sessionId);
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

function generateSessionId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(36).substring(2, 8);
  return `session-${timestamp}-${random}`;
}

async function tryLoadLastSession(): Promise<{ state: ChatState; sessionId: string } | null> {
  try {
    const sessions = await chatPersistence.listSessions();
    if (sessions.length > 0) {
      const lastSession = sessions[0]; // Most recent session
      const state = await chatPersistence.loadSession(lastSession.id);
      if (state) {
        return { state, sessionId: lastSession.id };
      }
    }
  } catch (error) {
    logger.error('Failed to load last session', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
  return null;
}

async function main() {
  logger.info('Starting RAG System Interactive Chat UI');

  // Initialize persistence
  await chatPersistence.initialize();

  const docStore = await createDocumentStore();

  const instructions = `
You are a helpful assistant with access to a knowledge base.
Use the ${knowledgeToolName} tool to search, add, and delete documents in the knowledge base.
When answering questions, first search for relevant documents.
The ${knowledgeToolName} tool only returns relevant chunks of text, so you must use **getChunk** to retrieve full documents if needed.
If no relevant information is found, say "I don't know".
Always provide concise and accurate answers based on the knowledge base.

Special instructions:
- When the user says "remember this", automatically add the content they want you to remember to the knowledge base using the ${knowledgeToolName} tool with action type "add".
- When the user says "forget this", delete the specified document from the knowledge base using the ${knowledgeToolName} tool with action type "delete".
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

  // Try to load the last session or create a new one
  const lastSession = await tryLoadLastSession();
  let currentSessionId: string;
  let state: ChatState;

  if (lastSession) {
    currentSessionId = lastSession.sessionId;
    state = lastSession.state;
  } else {
    currentSessionId = generateSessionId();
    state = {
      messages: [],
      previousResponseId: null
    };
  }

  const context: AppContext = {
    docStore,
    instructions,
    tools,
    toolExecutors,
    currentSessionId
  };

  logger.info('RAG System initialized', {
    toolsCount: tools.length,
    executorsCount: Object.keys(toolExecutors).length
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('🌝 Interactive Chat UI - RAG System');
  console.log(`Current session: ${currentSessionId}`);
  if (state.messages.length > 0) {
    console.log(`Loaded previous session with ${state.messages.length} messages`);
  }
  console.log('Type your questions or commands:');
  console.log('- "quit" or "exit" to exit');
  console.log('- "clear" to clear chat history');
  console.log('- "compress" to compress chat history');
  console.log('- "load <filename>" to load a document');
  console.log('- "save [session_id]" to save current session');
  console.log('- "session <session_id>" to load a session');
  console.log('- "sessions" to list all sessions');
  console.log('- "delete <session_id>" to delete a session');
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
