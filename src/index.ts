import 'dotenv/config';
import { RAGSystem } from './rag.js';

async function main() {
  const rag = new RAGSystem();

  console.log('RAGシステムにドキュメントを追加中...');
  
  await rag.addDocuments([
    {
      text: 'TypeScriptは、Microsoft社が開発したオープンソースのプログラミング言語です。JavaScriptのスーパーセットとして設計されており、静的型付けを提供します。',
      metadata: { title: 'TypeScript概要', category: 'プログラミング言語' }
    },
    {
      text: 'Node.jsは、V8 JavaScriptエンジンで動作するJavaScriptランタイム環境です。サーバーサイドでJavaScriptを実行することができます。',
      metadata: { title: 'Node.js概要', category: 'ランタイム' }
    },
    {
      text: 'RAG（Retrieval-Augmented Generation）は、情報検索と生成を組み合わせたAI技術です。関連する文書を検索し、その情報を基に回答を生成します。',
      metadata: { title: 'RAG技術', category: 'AI技術' }
    }
  ]);

  console.log(`ドキュメント数: ${rag.getDocumentCount()}`);
  console.log('\n質問に答えます...\n');

  const questions = [
    'TypeScriptとは何ですか？',
    'Node.jsについて教えてください',
    'RAGの仕組みを説明してください'
  ];

  for (const question of questions) {
    console.log(`質問: ${question}`);
    try {
      const result = await rag.query(question);
      console.log(`回答: ${result.answer}`);
      console.log(`類似度スコア: ${result.sources.map(s => s.similarity.toFixed(3)).join(', ')}`);
    } catch (error) {
      console.error(`エラーが発生しました: ${error}`);
    }
    console.log('---\n');
  }

  // キャッシュ統計表示
  const cacheStats = rag.getCacheStats();
  const cacheInfo = await rag.getCacheInfo();
  
  console.log('キャッシュ統計:');
  console.log(`- ヒット数: ${cacheStats.hits}`);
  console.log(`- ミス数: ${cacheStats.misses}`);
  console.log(`- ヒット率: ${(cacheStats.hitRate * 100).toFixed(1)}%`);
  console.log(`- キャッシュサイズ: ${cacheInfo.size} エントリ`);
  console.log(`- キャッシュファイル: ${cacheInfo.cacheFile}`);
  if (cacheInfo.oldestEntry) {
    console.log(`- 最古エントリ: ${new Date(cacheInfo.oldestEntry).toLocaleString()}`);
  }
  if (cacheInfo.newestEntry) {
    console.log(`- 最新エントリ: ${new Date(cacheInfo.newestEntry).toLocaleString()}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}