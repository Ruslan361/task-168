# -*- coding: utf-8 -*-
"""Emotion Analyzer Agent implementation."""

from typing import Dict, Any, Tuple

from .base_agent import BaseMwsAgent
from .utils import call_mws_gpt

class EmotionAnalyzerAgent(BaseMwsAgent):
    """Agent responsible for analyzing the user's emotion."""

    def run(self, query: str, shared_context: Dict[str, Any]) -> Tuple[str, float]:
        # Extract the actual query
        actual_query = query
        if "Последний запрос клиента:" in query:
             query_start = query.find("Последний запрос клиента: ") + len("Последний запрос клиента: ")
             query_end = query.find(""", query_start)
             if query_start != -1 and query_end != -1:
                 actual_query = query[query_start:query_end].strip(""")

        def execution():
            emotion = call_mws_gpt([
                {
                    "role": "system",
                    "content": f"""
                        Ты {self.role}. {self.backstory}
                        Оцени эмоциональное состояние клиента. Используй категории: 'нейтральная', 'недовольство', 'любопытство'.
                        Примеры:
                        - 'интернет' → 'нейтральная'
                        - 'раздача интернета' → 'нейтральная'
                        - 'не работает интернет' → 'недовольство'
                        - 'подключенные услуги' → 'нейтральная'
                        - 'куда пропали 120 рублей' → 'недовольство'
                        - 'хочу карпулинг как blablacar' → 'любопытство'
                        - 'приложение не работает списали деньги' → 'недовольство'
                        Верни только название эмоции.
                    """
                },
                {"role": "user", "content": f"Запрос: {actual_query}"}
            ])
            shared_context['emotion'] = emotion # Update shared context
            shared_context['question'] = actual_query
            return emotion

        return self._log_and_measure_time(query, execution)
