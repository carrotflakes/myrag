import OpenAI from 'openai';
import { ChatState, ChatMessage } from './chat';
import logger from './logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

interface CompressionResult {
  compressedState: ChatState;
  originalMessageCount: number;
  compressedMessageCount: number;
  compressionRatio: number;
}

/**
 * Compress chat history using GPT to summarize conversations
 * while preserving important context and recent messages
 */
export class ChatHistoryCompressor {
  private readonly maxMessagesBeforeCompression: number;
  private readonly keepRecentMessages: number;
  private readonly compressionModel: string;

  constructor(
    maxMessagesBeforeCompression: number = 50,
    keepRecentMessages: number = 10,
    compressionModel: string = 'gpt-4.1-mini'
  ) {
    this.maxMessagesBeforeCompression = maxMessagesBeforeCompression;
    this.keepRecentMessages = keepRecentMessages;
    this.compressionModel = compressionModel;
  }

  /**
   * Check if compression is needed based on message count
   */
  shouldCompress(state: ChatState): boolean {
    return state.messages.length > this.maxMessagesBeforeCompression;
  }

  /**
   * Compress chat history by summarizing older messages
   */
  async compressHistory(state: ChatState): Promise<CompressionResult> {
    const totalMessages = state.messages.length;

    if (totalMessages <= this.keepRecentMessages) {
      logger.info('No compression needed - too few messages', { totalMessages });
      return {
        compressedState: state,
        originalMessageCount: totalMessages,
        compressedMessageCount: totalMessages,
        compressionRatio: 1.0
      };
    }

    // Split messages into two parts: old (to compress) and recent (to keep)
    const messagesToCompress = state.messages.slice(0, -this.keepRecentMessages);
    const recentMessages = state.messages.slice(-this.keepRecentMessages);

    logger.info('Starting chat history compression', {
      totalMessages,
      messagesToCompress: messagesToCompress.length,
      recentMessages: recentMessages.length
    });

    try {
      // Create a summary of the conversation to compress
      const summary = await this.createConversationSummary(messagesToCompress);

      // Create a summary message to replace the compressed messages
      const summaryMessage: ChatMessage = {
        role: 'ai',
        content: `[COMPRESSED HISTORY]: ${summary}`,
        timestamp: new Date()
      };

      // Create new state with summary + recent messages
      const compressedState: ChatState = {
        messages: [summaryMessage, ...recentMessages],
        previousResponseId: state.previousResponseId
      };

      const compressionRatio = compressedState.messages.length / totalMessages;

      logger.info('Chat history compression completed', {
        originalMessageCount: totalMessages,
        compressedMessageCount: compressedState.messages.length,
        compressionRatio: compressionRatio.toFixed(2),
        summaryLength: summary.length
      });

      return {
        compressedState,
        originalMessageCount: totalMessages,
        compressedMessageCount: compressedState.messages.length,
        compressionRatio
      };

    } catch (error) {
      logger.error('Failed to compress chat history', {
        error: error instanceof Error ? error.message : String(error)
      });

      // Return original state if compression fails
      return {
        compressedState: state,
        originalMessageCount: totalMessages,
        compressedMessageCount: totalMessages,
        compressionRatio: 1.0
      };
    }
  }

  /**
   * Create a conversation summary using GPT
   */
  private async createConversationSummary(messages: ChatMessage[]): Promise<string> {
    // Convert messages to a readable format for GPT
    const conversationText = this.formatMessagesForSummary(messages);

    const response = await openai.responses.create({
      model: this.compressionModel,
      temperature: 0,
      max_output_tokens: 500,
      instructions: `You are a conversation summarizer. Create a concise but comprehensive summary of the following conversation.
          
          Important guidelines:
          - Preserve key facts, decisions, and important context
          - Include any document additions, searches, or knowledge base changes
          - Maintain chronological flow of important events
          - Keep technical details and specific information
          - Use approximately 200-400 words
          - Focus on actionable information and important context`,
      input: [
        {
          role: 'user',
          content: `Please summarize this conversation:\n\n${conversationText}`
        }
      ]
    });

    const summary = response.output_text?.trim();
    if (!summary) {
      throw new Error('Failed to generate conversation summary');
    }

    return summary;
  }

  /**
   * Format messages into readable text for summarization
   */
  private formatMessagesForSummary(messages: ChatMessage[]): string {
    return messages.map(msg => {
      switch (msg.role) {
        case 'user':
          return `User: ${msg.content}`;
        case 'ai':
          return `Assistant: ${msg.content}`;
        case 'toolCall':
          return `Tool Call: ${msg.functionName}(${msg.arguments})`;
        case 'toolResponse':
          return `Tool Result: ${msg.content.slice(0, 200)}${msg.content.length > 200 ? '...' : ''}`;
        case 'webSearchCall':
          return `Web Search: [search performed]`;
        default:
          return `${(msg as any).role || 'unknown'}: ${JSON.stringify(msg)}`;
      }
    }).join('\n');
  }

  /**
   * Get compression statistics
   */
  getCompressionStats(result: CompressionResult): string {
    const savedMessages = result.originalMessageCount - result.compressedMessageCount;
    const savedPercentage = ((1 - result.compressionRatio) * 100).toFixed(1);

    return `Compressed ${result.originalMessageCount} → ${result.compressedMessageCount} messages (${savedMessages} messages saved, ${savedPercentage}% reduction)`;
  }
}

export const defaultCompressor = new ChatHistoryCompressor();