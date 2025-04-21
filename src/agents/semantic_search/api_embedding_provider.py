import requests
import json
from typing import List
from .embedding_provider import EmbeddingProvider

# APIEmbeddingProvider
class APIEmbeddingProvider(EmbeddingProvider):
    """Embedding provider that uses remote API."""
    
    def __init__(self, api_key: str, api_base_url: str = "https://api.gpt.mws.ru/v1", 
                 model: str = "bge-m3"):
        """
        Initialize API embedding provider.
        
        Args:
            api_key: API key for authentication
            api_base_url: Base URL for the API
            model: Model name to use for embeddings
        """
        self.api_key = api_key
        self.api_base_url = api_base_url
        self.embedding_endpoint = f"{api_base_url}/embeddings"
        self.model = model
    
    def get_embedding(self, text: str) -> List[float]:
        """
        Generate embedding for a single text using API.
        
        Args:
            text: Text to embed
            
        Returns:
            List of floats representing the embedding
        """
        if not text:
            raise ValueError("Input text cannot be empty.")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": self.model,
            "input": text,
        }

        try:
            response = requests.post(self.embedding_endpoint, headers=headers, json=payload)
            response.raise_for_status()

            response_data = response.json()

            if "data" in response_data and isinstance(response_data["data"], list) and len(response_data["data"]) > 0:
                if "embedding" in response_data["data"][0] and isinstance(response_data["data"][0]["embedding"], list):
                    embedding = response_data["data"][0]["embedding"]
                    return embedding
                else:
                    raise ValueError("API response format error: 'embedding' key missing or not a list.")
            else:
                if "error" in response_data:
                    raise ValueError(f"API returned an error: {response_data['error']}")
                raise ValueError(f"Unexpected API response structure: {response_data}")

        except requests.exceptions.RequestException as e:
            error_message = f"API request failed: {e}"
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_details = e.response.json()
                    error_message += f"\nResponse: {error_details}"
                except json.JSONDecodeError:
                    error_message += f"\nResponse text: {e.response.text}"
            print(error_message)
            raise
        
        except (KeyError, IndexError, TypeError, ValueError) as e:
            error_message = f"Failed to parse API response: {e}"
            print(error_message)
            raise ValueError(error_message) from e
    
    def get_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts.
        
        Args:
            texts: List of texts to embed
            
        Returns:
            List of embeddings
        """
        return [self.get_embedding(text) for text in texts]
