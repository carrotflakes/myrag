import OpenAI from 'openai';
import { Document } from './document.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LLMService {
  private openai: OpenAI;

  constructor(apiKey?: string) {
    this.openai = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY
    });
  }

  async generateResponse(
    instructions: string,
    input: string,
    model: string = 'gpt-4.1-mini',
    temperature: number = 0.7
  ): Promise<string> {
    try {
      // Use Responses API
      const response = await this.openai.responses.create({
        model,
        instructions,
        input,
        temperature
      });

      return response.output_text || '';
    } catch (error) {
      throw new Error(`Failed to generate response: ${error}`);
    }
  }

  createRAGPrompt(query: string, context: Document[]): { instructions: string; input: string } {
    const contextText = context
      .map(doc => doc.content)
      .join('\n\n');

    const instructions = `You are an assistant that answers questions based on the given context.
If the information is not included in the context, please answer "I don't know".
Please provide concise and accurate answers.

Context:
${contextText}`;

    return {
      instructions,
      input: query
    };
  }
}