from typing import List
from .embedding_provider import EmbeddingProvider

# LocalEmbeddingProvider
class LocalEmbeddingProvider(EmbeddingProvider):
    """Embedding provider that uses local models."""
    
    def __init__(self, model_name_or_path: str = "sentence-transformers/all-MiniLM-L6-v2"):
        """
        Initialize local embedding provider.
        
        Args:
            model_name_or_path: Model name or path for sentence transformer
        """
        try:
            from sentence_transformers import SentenceTransformer
            self.model = SentenceTransformer(model_name_or_path)
            print(f"Loaded local model: {model_name_or_path}")
        except ImportError:
            raise ImportError(
                "Sentence Transformers not installed. Please install with: "
                "pip install sentence-transformers"
            )
    
    def get_embedding(self, text: str) -> List[float]:
        """
        Generate embedding for a single text using local model.
        
        Args:
            text: Text to embed
            
        Returns:
            List of floats representing the embedding
        """
        if not text:
            raise ValueError("Input text cannot be empty.")
            
        # Convert to list to match API output format
        embedding = self.model.encode(text).tolist()
        return embedding
    
    def get_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts efficiently.
        
        Args:
            texts: List of texts to embed
            
        Returns:
            List of embeddings
        """
        # Batch processing is much more efficient with transformer models
        embeddings = self.model.encode(texts)
        return [emb.tolist() for emb in embeddings]
