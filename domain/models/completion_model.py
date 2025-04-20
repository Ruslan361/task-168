from typing import Dict, Any

from .data_source import APIClient


class CompletionModel:
    def __init__(self, _id: str, client: APIClient):
        self.id = _id
        self.client = client

    def get_completion(self, prompt: str, temperature: float, max_tokens: int) -> Dict[str, Any]:
        payload = {
            "model": self.id,
            "prompt": prompt,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        response = self.client.send_request("POST", "completions", payload)
        response.raise_for_status()

        return response.json()
