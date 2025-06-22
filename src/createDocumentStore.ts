import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { dirname, join } from 'path/posix';
import { fileURLToPath } from 'url';
import { InMemoryDocumentStore } from './documentStore';
import logger from './logger';

function loadMarkdownFiles(sourceDir: string): { filename: string; content: string }[] {
  const files: { filename: string; content: string }[] = [];

  if (!existsSync(sourceDir)) {
    logger.warn('Source directory not found', { sourceDir });
    return files;
  }

  try {
    const entries = readdirSync(sourceDir);

    for (const entry of entries) {
      const fullPath = join(sourceDir, entry);
      const stat = statSync(fullPath);

      if (stat.isFile() && entry.toLowerCase().endsWith('.md')) {
        try {
          const content = readFileSync(fullPath, 'utf8');
          files.push({ filename: entry, content });
          logger.info('Loaded markdown file', {
            filename: entry,
            path: fullPath,
            size: content.length
          });
        } catch (error) {
          logger.error('Failed to read markdown file', {
            filename: entry,
            path: fullPath,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    logger.info('Finished loading markdown files', {
      sourceDir,
      totalFiles: files.length
    });
  } catch (error) {
    logger.error('Failed to read source directory', {
      sourceDir,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return files;
}

export function createDocumentStore() {
  logger.info('Creating document store');
  const docStore = new InMemoryDocumentStore();

  // Add the built-in document
  docStore.addDocument(`Lunlun (ルンルン) is a Japanese Virtual YouTuber affiliated with NIJISANJI, debuting as part of the unit "Ayakaki" (あやかき) alongside Shiga Riko, Tamanoi Nana, Kisara, and Kozue Mone.`,
    { source: 'builtin', type: 'anime' }
  );

  // Load all markdown files from source directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const sourceDir = join(__dirname, '..', 'source');

  const markdownFiles = loadMarkdownFiles(sourceDir);

  for (const { filename, content } of markdownFiles) {
    const baseName = filename.replace(/\.md$/i, '');
    docStore.addDocument(content, {
      source: 'file',
      filename: filename,
      baseName: baseName,
      loadedAt: new Date().toISOString()
    });
  }

  logger.info('Document store created', {
    totalDocuments: markdownFiles.length + 1 // +1 for builtin
  });

  return docStore;
}
