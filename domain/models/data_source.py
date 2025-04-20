import requests


class APIClient:
    BASE_URL = "https://api.gpt.mws.ru/v1"

    def __init__(self, api_key: str):
        self.api_key = api_key

    def send_request(self, method: str, endpoint: str, json: dict) -> requests.Response:
        url = f"{self.BASE_URL}/{endpoint}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        return requests.request(method=method, url=url, headers=headers, json=json)
