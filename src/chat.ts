import OpenAI from 'openai';
import logger from './logger';

export type ChatMessage = {
  role: "user" | "ai";
  content: string;
  timestamp: Date;
} | {
  role: "toolCall";
  functionName: string;
  arguments: string;
  id: string;
  timestamp: Date;
} | {
  role: "toolResponse";
  id: string;
  content: string;
  timestamp: Date;
} | {
  role: "webSearchCall";
  timestamp: Date;
};

export interface ChatState {
  messages: ChatMessage[];
  previousResponseId: string | null;
}

export type Tool = OpenAI.Responses.Tool;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function processLlm(instructions: string, tools: Tool[], state: ChatState): Promise<ChatState> {
  const lastMessage = state.messages.at(-1);
  const input = lastMessage?.role === 'user' ? lastMessage.content : lastMessage?.role === 'toolResponse' ? [{
    type: "function_call_output" as const,
    call_id: lastMessage.id,
    output: lastMessage.content,
  }] : undefined;

  logger.info('Processing LLM request', {
    inputType: lastMessage?.role,
    previousResponseId: state.previousResponseId,
    toolsCount: tools.length
  });

  const response = await openai.responses.create({
    model: 'gpt-4.1-mini',
    temperature: 0,
    parallel_tool_calls: false,
    instructions,
    input,
    previous_response_id: state.previousResponseId,
    tools,
    store: true,
    metadata: {
      project: 'myrag',
    },
  });

  logger.info('LLM response received', {
    responseId: response.id,
    outputCount: response.output.length
  });

  const messages: ChatMessage[] = [
    ...state.messages,
  ];

  for (const output of response.output) {
    if (output.type === 'message') {
      for (const content of output.content) {
        if (content.type === 'output_text') {
          messages.push({ role: 'ai', content: content.text, timestamp: new Date() });
        } else {
          throw new Error(`Unexpected content type: ${content}`);
        }
      }
    } else if (output.type === "function_call") {
      messages.push({
        role: 'toolCall',
        id: output.call_id,
        functionName: output.name,
        arguments: output.arguments,
        timestamp: new Date()
      });
    } else if (output.type === "web_search_call") {
      messages.push({
        role: 'webSearchCall',
        timestamp: new Date()
      });
    } else {
      throw new Error(`Unexpected output type: ${output.type}`);
    }
  }
  return {
    messages,
    previousResponseId: response.id ?? null,
  };
}

export type ToolExecutor = (args: string) => Promise<string>;

export async function processTool(tools: Record<string, ToolExecutor>, state: ChatState): Promise<ChatState | null> {
  const lastMessage = state.messages.at(-1);
  if (lastMessage?.role !== 'toolCall') {
    return null; // No tool call to process
  }

  const { functionName, arguments: args } = lastMessage;

  logger.info('Processing tool call', {
    functionName,
    callId: lastMessage.id,
    argsLength: args.length
  });

  const tool = tools[functionName];
  if (!tool) {
    logger.error('Unknown tool function', { functionName });
    throw new Error(`Unknown tool function: ${functionName}`);
  }

  try {
    const toolResult = await tool(args);
    logger.info('Tool call completed', {
      functionName,
      callId: lastMessage.id,
      resultLength: toolResult.length
    });

    const responseMessage: ChatMessage = {
      role: 'toolResponse',
      id: lastMessage.id,
      content: toolResult,
      timestamp: new Date()
    };
    return {
      ...state,
      messages: [...state.messages, responseMessage]
    };
  } catch (error) {
    logger.error('Tool call failed', {
      functionName,
      callId: lastMessage.id,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function addMessage(state: ChatState, message: ChatMessage): ChatState {
  return {
    ...state,
    messages: [...state.messages, message]
  };
}

export function addUserMessage(state: ChatState, content: string): ChatState {
  const userMessage: ChatMessage = {
    role: 'user',
    content,
    timestamp: new Date()
  };
  return addMessage(state, userMessage);
}

export async function processChat(instructions: string, tools: Tool[], toolExecutors: Record<string, ToolExecutor>, state: ChatState, message: string): Promise<ChatState> {
  state = addUserMessage(state, message);
  state = await processLlm(instructions, tools, state);

  while (true) {
    const newState = await processTool(toolExecutors, state);
    if (!newState) break;
    state = newState;
    state = await processLlm(instructions, tools, state);
  }

  return state;
}
