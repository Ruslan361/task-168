from typing import List

from . import ChatCompletionModel, CompletionModel, EmbeddingModel
from .data_source import APIClient


class ModelRegistry:
    AVAILABLE_MODELS = {
        "chat_completion": ["mws-gpt-alpha", "cotype-preview-32k"],
        "completion": ["kodify-2.0", "mws-gpt-alpha"],
        "embedding": ["bge-m3"],
    }

    def __init__(self, client: APIClient):
        self.client = client

    def get_available_models_id(self) -> List[str]:
        response = self.client.send_request("POST", "models", {})
        response.raise_for_status()

        return [model['id'] for model in response.json()['data']]

    def get_chat_completion_model(self, _id: str) -> ChatCompletionModel:
        if _id not in self.AVAILABLE_MODELS["chat_completion"]:
            raise ValueError(f"Model {_id} is not available for chat completion.")
        return ChatCompletionModel(_id, self.client)

    def get_completion_model(self, _id: str) -> CompletionModel:
        if _id not in self.AVAILABLE_MODELS["completion"]:
            raise ValueError(f"Model {_id} is not available for text completion.")
        return CompletionModel(_id, self.client)

    def get_embedding_model(self, _id: str) -> EmbeddingModel:
        if _id not in self.AVAILABLE_MODELS["embedding"]:
            raise ValueError(f"Model {_id} is not available for embeddings.")
        return EmbeddingModel(_id, self.client)
