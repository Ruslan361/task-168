from typing import List, Dict, Any

from .data_source import APIClient


class Message:
    def __init__(self, role: str, content: str):
        self.role = role
        self.content = content

    def to_dict(self):
        return {
            "role": self.role,
            "content": self.content
        }


class ChatCompletionModel:
    def __init__(self, _id: str, client: APIClient):
        self.id = _id
        self.client = client

    def get_chat_completion(self, messages: List[Message], temperature: float) -> Dict[str, Any]:
        payload = {
            "model": self.id,
            "messages": [m.to_dict() for m in messages],
            "temperature": temperature
        }
        response = self.client.send_request("POST", "chat/completions", payload)
        response.raise_for_status()

        return response.json()
