import os

import dotenv

import domain.models as models

dotenv.load_dotenv()

api_key = os.getenv("API_KEY")
client = models.APIClient(api_key)
registry = models.ModelRegistry(client)

model = registry.get_chat_completion_model("mws-gpt-alpha")

messages = [
    models.Message(role="system", content="Ты помощник"),
    models.Message(role="user", content="Привет! Как дела?")
]

print(model.get_chat_completion(messages, 0.6))
