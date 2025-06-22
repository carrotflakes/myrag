import 'dotenv/config';

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { ChatState, addUserMessage, processLlm, processTool } from './chat';
import { createKnowledgeExecutor, createKnowledgeTool } from './tools/knowledge';
import { createDocumentStore } from './createDocumentStore';
import logger from './logger';

async function main() {
  logger.info('Starting RAG System Interactive Chat UI');
  
  const docStore = createDocumentStore();

  const instructions = `
You are a helpful assistant with access to a knowledge base.
Use the knowledge tool to search, add, and delete documents in the knowledge base.
When answering questions, first search for relevant documents.
The knowledge tool only returns relevant chunks of text, so you must use **getChunk** to retrieve full documents if needed.
If no relevant information is found, say "I don't know".
Always provide concise and accurate answers based on the knowledge base.

Special instructions:
- When the user says "remember this", automatically add the content they want you to remember to the knowledge base using the knowledge tool with action type "add".
 `.trim();

  const tools = [createKnowledgeTool()];
  const toolExecutors = {
    ...createKnowledgeExecutor(docStore),
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
      const query = input.trim();

      if (query.toLowerCase() === 'quit' || query.toLowerCase() === 'exit') {
        logger.info('User initiated shutdown');
        console.log('Goodbye!');
        rl.close();
        return;
      }

      if (query.toLowerCase() === 'clear') {
        logger.info('Chat history cleared by user');
        state = {
          messages: [],
          previousResponseId: null
        };
        console.log('Chat history cleared.\n');
        askQuestion();
        return;
      }

      if (query.toLowerCase().startsWith('覚えてください') || query.toLowerCase().startsWith('remember ')) {
        const contentToRemember = query.replace(/^(覚えてください|remember )/i, '').trim();
        logger.info('Adding content to knowledge base', { content: contentToRemember });
        
        if (!contentToRemember) {
          console.log('何を覚えればよいでしょうか？内容を教えてください。\n');
          askQuestion();
          return;
        }

        try {
          const document = await docStore.addDocument(contentToRemember, {
            source: 'user_input',
            addedAt: new Date().toISOString()
          });

          logger.info('Content added to knowledge base', {
            documentId: document.id,
            contentLength: contentToRemember.length
          });
          
          console.log(`✅ 覚えました！知識ベースに追加されました (ID: ${document.id})\n`);
        } catch (error) {
          logger.error('Error adding content to knowledge base', {
            content: contentToRemember,
            error: error instanceof Error ? error.message : String(error)
          });
          console.error('知識ベースへの追加中にエラーが発生しました:', error instanceof Error ? error.message : error);
          console.log('');
        }
        askQuestion();
        return;
      }

      if (query.toLowerCase().startsWith('load ')) {
        const filename = query.slice(5).trim();
        logger.info('Document load requested', { filename });
        try {
          if (!fs.existsSync(filename)) {
            logger.warn('File not found', { filename });
            console.log(`File not found: ${filename}\n`);
            askQuestion();
            return;
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
        } catch (error) {
          logger.error('Error loading document', {
            filename,
            error: error instanceof Error ? error.message : String(error)
          });
          console.error('Error loading document:', error instanceof Error ? error.message : error);
          console.log('');
        }
        askQuestion();
        return;
      }

      if (!query) {
        askQuestion();
        return;
      }

      try {
        console.log('🤖 Processing...');
        logger.info('Processing user query', { query });

        // Add user message
        state = addUserMessage(state, query);
        
        // Process LLM first time
        state = await processLlm(instructions, tools, state);
        
        // Display the latest message from LLM
        const latestMessage = state.messages[state.messages.length - 1];
        if (latestMessage.role === 'ai') {
          console.log(`🤖 Assistant: ${latestMessage.content}`);
        } else if (latestMessage.role === 'toolCall') {
          console.log(`🔧 Tool Call: ${latestMessage.functionName}(${latestMessage.arguments})`);
        }
        
        // Process tools in loop
        while (true) {
          const newState = await processTool(toolExecutors, state);
          if (!newState) break;
          
          state = newState;
          
          // Display tool response
          const lastMessage = state.messages[state.messages.length - 1];
          if (lastMessage.role === 'toolResponse') {
            console.log(`🔧 Tool Result: ${lastMessage.content.slice(0, 200)}${lastMessage.content.length > 200 ? '...' : ''}`);
          }
          
          // Process LLM again
          state = await processLlm(instructions, tools, state);
          
          // Display any new AI messages
          const latestMessage = state.messages[state.messages.length - 1];
          if (latestMessage.role === 'ai') {
            console.log(`🤖 Assistant: ${latestMessage.content}`);
          } else if (latestMessage.role === 'toolCall') {
            console.log(`🔧 Tool Call: ${latestMessage.functionName}(${latestMessage.arguments})`);
          }
        }
        
        logger.info('Chat processing completed', {
          finalMessageCount: state.messages.length
        });
        
        console.log(''); // Add blank line after completion
      } catch (error) {
        logger.error('Error processing query', {
          query,
          error: error instanceof Error ? error.message : String(error)
        });
        console.error('Error:', error instanceof Error ? error.message : error);
        console.log('');
      }

      askQuestion();
    });
  };

  askQuestion();
}

main().catch(console.error);
