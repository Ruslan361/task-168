from abc import ABC, abstractmethod
from typing import List

# Abstract base class for embedding providers
class EmbeddingProvider(ABC):
    """Base class for all embedding providers."""
    
    @abstractmethod
    def get_embedding(self, text: str) -> List[float]:
        """Generate embeddings for the given text."""
        pass
    
    @abstractmethod
    def get_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a batch of texts."""
        pass
