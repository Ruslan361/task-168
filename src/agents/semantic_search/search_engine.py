import os
import numpy as np
import pandas as pd
from typing import List, Dict, Tuple, Optional, Union, Any
import faiss
import json

from .embedding_provider import EmbeddingProvider
from .api_embedding_provider import APIEmbeddingProvider
from .local_embedding_provider import LocalEmbeddingProvider

# Класс SemanticSearch для работы напрямую с FAISS и DataFrame
class SemanticSearch:
    """
    A class to perform semantic search on a corpus of text using FAISS directly with DataFrames.
    """
    
    def __init__(self, embedding_provider: EmbeddingProvider):
        """
        Initialize the semantic search engine.
        
        Args:
            embedding_provider: Provider for generating embeddings
        """
        self.embedding_provider = embedding_provider
        self.faiss_index = None
        self.df = None
        self.text_column = None
        self.embedding_dimension = None
        
    @classmethod
    def with_api_provider(cls, api_key: str, api_base_url: str = "https://api.gpt.mws.ru/v1", 
                         model: str = "bge-m3"):
        """Factory method to create a SemanticSearch with API provider."""
        provider = APIEmbeddingProvider(api_key, api_base_url, model)
        return cls(provider)
    
    @classmethod
    def with_local_provider(cls, model_name_or_path: str = "sentence-transformers/all-MiniLM-L6-v2"):
        """Factory method to create a SemanticSearch with local provider."""
        provider = LocalEmbeddingProvider(model_name_or_path)
        return cls(provider)
        
    def load_index(self, df_path: str, index_path: str, text_column: str = "name"):
        """
        Load DataFrame and FAISS index from disk.
        
        Args:
            df_path: Path to the saved DataFrame (CSV or pickle)
            index_path: Path to the saved FAISS index
            text_column: Name of the column containing text to search
        """
        self.text_column = text_column
        
        try:
            print(f"Loading DataFrame from {df_path}...")
            if df_path.endswith('.csv'):
                self.df = pd.read_csv(df_path)
            elif df_path.endswith('.pkl') or df_path.endswith('.pickle'):
                self.df = pd.read_pickle(df_path)
            else:
                raise ValueError(f"Unsupported file format: {df_path}")
            
            print(f"Loading FAISS index from {index_path}...")
            self.faiss_index = faiss.read_index(index_path)
            
            # Get embedding dimension from index
            self.embedding_dimension = self.faiss_index.d
            
            print(f"Loaded DataFrame with {len(self.df)} items and FAISS index with dimension {self.embedding_dimension}")
        except Exception as e:
            print(f"Error loading DataFrame or index: {e}")
            raise
    
    def create_index_from_dataframe(self, df: pd.DataFrame, text_column: str = "name",
                                   save_path: Optional[str] = None):
        """
        Create a FAISS index from a pandas DataFrame.
        
        Args:
            df: DataFrame containing the corpus
            text_column: Column name containing the text to be embedded
            save_path: Optional path to save the created index and DataFrame
        """
        self.text_column = text_column
        self.df = df.copy()
        
        print(f"Creating index from DataFrame with {len(df)} rows...")
        
        # Generate embeddings for each text
        embeddings = []
        print("Generating embeddings (this may take some time)...")
        
        for i, text in enumerate(df[text_column]):
            try:
                if i % 100 == 0 and i > 0:
                    print(f"  Processed {i}/{len(df)} items...")
                
                embedding = self.embedding_provider.get_embedding(text)
                embeddings.append(embedding)
                
            except Exception as e:
                print(f"Error generating embedding for '{text[:50]}...': {e}")
                # Use zeros as placeholder
                if embeddings:  # If we already have at least one embedding, use its dimension
                    placeholder = [0.0] * len(embeddings[0])
                else:
                    # Assume default dimension is 1024 for BGE-M3
                    placeholder = [0.0] * 1024
                embeddings.append(placeholder)
        
        # Convert to numpy array
        embeddings_array = np.array(embeddings).astype('float32')
        self.embedding_dimension = embeddings_array.shape[1]
        
        # Create FAISS index
        print(f"Creating FAISS index with dimension {self.embedding_dimension}...")
        self.faiss_index = faiss.IndexFlatL2(self.embedding_dimension)
        self.faiss_index.add(embeddings_array)
        
        # Save if requested
        if save_path:
            self._save_index_and_df(save_path)
            
        print(f"Index creation complete, {len(embeddings)} items indexed")
        return self.faiss_index
    
    def create_index_from_processed_json(self, json_path: str, save_path: Optional[str] = None):
        """
        Создает FAISS индекс из обработанного JSON файла со структурой {name, content_data}.
        
        Args:
            json_path: Путь к JSON-файлу с обработанными данными
            save_path: Опциональный путь для сохранения индекса и DataFrame
        """
        # Загрузка данных из JSON
        print(f"Загрузка данных из {json_path}...")
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Создание DataFrame
        self.df = pd.DataFrame(data)
        self.text_column = "name"
        
        print(f"Создание индекса из DataFrame с {len(self.df)} строками...")
        
        # Генерация эмбеддингов для каждого name
        embeddings = []
        print("Генерация эмбеддингов (это может занять некоторое время)...")
        
        for i, text in enumerate(self.df[self.text_column]):
            try:
                if i % 100 == 0 and i > 0:
                    print(f"  Обработано {i}/{len(self.df)} элементов...")
                
                embedding = self.embedding_provider.get_embedding(text)
                embeddings.append(embedding)
                
            except Exception as e:
                print(f"Ошибка при создании эмбеддинга для '{text[:50]}...': {e}")
                # Заполняем нулями
                if embeddings:
                    placeholder = [0.0] * len(embeddings[0])
                else:
                    placeholder = [0.0] * 1024
                embeddings.append(placeholder)
        
        # Конвертация в numpy массив
        embeddings_array = np.array(embeddings).astype('float32')
        self.embedding_dimension = embeddings_array.shape[1]
        
        # Создание FAISS индекса
        print(f"Создание FAISS индекса с размерностью {self.embedding_dimension}...")
        self.faiss_index = faiss.IndexFlatL2(self.embedding_dimension)
        self.faiss_index.add(embeddings_array)
        
        # Сохранение при необходимости
        if save_path:
            self._save_index_and_df(save_path)
            
        print(f"Создание индекса завершено, {len(embeddings)} элементов проиндексировано")
        return self.faiss_index
    
    def _save_index_and_df(self, base_path: str):
        """
        Save the FAISS index and DataFrame to disk.
        
        Args:
            base_path: Base path where to save files
        """
        if self.faiss_index is None or self.df is None:
            raise ValueError("No index or DataFrame to save")
            
        # Create directory if it doesn't exist
        os.makedirs(base_path, exist_ok=True)
        
        df_path = os.path.join(base_path, "corpus.csv")
        index_path = os.path.join(base_path, "faiss.index")
        
        print(f"Saving DataFrame to {df_path}...")
        self.df.to_csv(df_path, index=False)
        
        print(f"Saving FAISS index to {index_path}...")
        faiss.write_index(self.faiss_index, index_path)
        
        print("DataFrame and index saved successfully")
    
    def search(self, query: str, k: int = 5) -> pd.DataFrame:
        """
        Поиск k наиболее похожих элементов на запрос.
        
        Args:
            query: Поисковый запрос
            k: Количество результатов для возврата
            
        Returns:
            DataFrame с результатами поиска и оценками сходства
        """
        if self.faiss_index is None or self.df is None:
            raise ValueError("Индекс или DataFrame не загружены. Загрузите или создайте сначала.")
        
        print(f"Поиск по запросу: '{query}'")
        
        # Генерация эмбеддинга для запроса
        query_embedding = np.array([self.embedding_provider.get_embedding(query)]).astype('float32')
        
        # Поиск похожих элементов
        distances, indices = self.faiss_index.search(query_embedding, k)
        
        # Получение соответствующих строк из DataFrame
        results = []
        for idx, distance in zip(indices[0], distances[0]):
            if idx < len(self.df):  # Проверка валидности индекса
                row = self.df.iloc[idx].to_dict()
                row["similarity_score"] = float(distance)  # Добавление дистанции как оценки
                results.append(row)
        
        # Создание DataFrame из результатов
        results_df = pd.DataFrame(results)
        
        # Сортировка по сходству (меньше - лучше для L2 дистанции)
        if not results_df.empty:
            results_df = results_df.sort_values("similarity_score", ascending=True)
        
        return results_df
    
    def search_batch(self, queries: List[str], k: int = 5) -> List[pd.DataFrame]:
        """
        Search for multiple queries at once.
        
        Args:
            queries: List of search queries
            k: Number of results to return for each query
            
        Returns:
            List of DataFrames containing the search results
        """
        return [self.search(query, k) for query in queries]
