# -*- coding: utf-8 -*-
"""Intent Recognizer Agent implementation."""

from typing import Dict, Any, Tuple

from .base_agent import BaseMwsAgent
from .utils import call_mws_gpt

class IntentRecognizerAgent(BaseMwsAgent):
    """Agent responsible for recognizing the user's intent."""

    def run(self, query: str, shared_context: Dict[str, Any]) -> Tuple[str, float]:
        # Extract the actual query
        actual_query = query
        if "Последний запрос клиента:" in query:
             query_start = query.find("Последний запрос клиента: ") + len("Последний запрос клиента: ")
             query_end = query.find(""", query_start)
             if query_start != -1 and query_end != -1:
                 actual_query = query[query_start:query_end].strip(""")

        def execution():
            intent = call_mws_gpt([
                {
                    "role": "system",
                    "content": f"""
                        Ты {self.role}. {self.backstory}
                        Определи намерение клиента из текста запроса. Используй категории: 'жалоба', 'запрос инструкции', 'запрос информации', 'уточнение запроса'.
                        Примеры:
                        - 'не работает интернет' → 'жалоба'
                        - 'раздача интернета' → 'запрос инструкции'
                        - 'интернет' → 'уточнение запроса'
                        - 'подключенные услуги' → 'запрос информации'
                        - 'куда пропали 120 рублей' → 'жалоба'
                        - 'хочу карпулинг как blablacar' → 'запрос информации'
                        - 'приложение не работает списали деньги' → 'жалоба'
                        Верни только название намерения.
                    """
                },
                {"role": "user", "content": f"Запрос: {actual_query}"}
            ])
            shared_context['intent'] = intent # Update shared context
            return intent

        return self._log_and_measure_time(query, execution)
