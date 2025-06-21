export interface Document {
  id: string;
  content: string;
  metadata?: Record<string, any>;
}

export class DocumentLoader {
  static fromText(text: string, metadata?: Record<string, any>): Document {
    return {
      id: crypto.randomUUID(),
      content: text,
      metadata
    };
  }

  static fromFile(filePath: string, content: string, metadata?: Record<string, any>): Document {
    return {
      id: crypto.randomUUID(),
      content,
      metadata: { ...metadata, filePath }
    };
  }
}

export class TextChunker {
  constructor(
    private chunkSize: number = 1000,
    private chunkOverlap: number = 200
  ) {}

  chunk(document: Document): Document[] {
    const text = document.content;
    const chunks: Document[] = [];
    
    if (text.length <= this.chunkSize) {
      return [document];
    }

    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      const end = Math.min(start + this.chunkSize, text.length);
      const chunkContent = text.slice(start, end);

      chunks.push({
        id: `${document.id}_chunk_${chunkIndex}`,
        content: chunkContent,
        metadata: {
          ...document.metadata,
          chunkIndex,
          parentId: document.id
        }
      });

      if (end >= text.length) break;
      start = end - this.chunkOverlap;
      chunkIndex++;
    }

    return chunks;
  }

  chunkMultiple(documents: Document[]): Document[] {
    return documents.flatMap(doc => this.chunk(doc));
  }
}