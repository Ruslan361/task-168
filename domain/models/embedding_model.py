from typing import Dict, Any

from .data_source import APIClient


class EmbeddingModel:
    def __init__(self, _id: str, client: APIClient):
        self.id = _id
        self.client = client

    def get_embedding(self, _input: str) -> Dict[str, Any]:
        payload = {
            "model": self.id,
            "input": _input
        }

        response = self.client.send_request("POST", "embeddings", payload)
        response.raise_for_status()

        return response.json()
