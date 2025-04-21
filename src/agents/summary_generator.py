# -*- coding: utf-8 -*-
"""Summary Generator Agent implementation."""

from typing import Dict, Any, Tuple

from .base_agent import BaseMwsAgent
from .utils import call_mws_gpt

class SummaryGeneratorAgent(BaseMwsAgent):
    """Agent responsible for generating a summary of the interaction."""

    def run(self, query: str, shared_context: Dict[str, Any]) -> Tuple[str, float]:
        # Extract the actual query
        actual_query = query
        if "Последний запрос клиента:" in query:
             query_start = query.find("Последний запрос клиента: ") + len("Последний запрос клиента: ")
             query_end = query.find(""", query_start)
             if query_start != -1 and query_end != -1:
                 actual_query = query[query_start:query_end].strip(""")

        def execution():
            emotion = shared_context.get('emotion', 'нейтральная').lower()
            intent = shared_context.get('intent', '')
            reference_answer = shared_context.get('reference_answer', '')
            action = shared_context.get('action', '')
            discount_details = shared_context.get('discount_details', '')
            alternative_service = shared_context.get('alternative_service', '')
            is_discount_offered = shared_context.get('discount_offered', False) # Use boolean flag
            is_alternative_offered = bool(alternative_service) # Use boolean flag

            tone_instruction = "" # Tone might not be strictly necessary for summary, but kept for consistency
            if 'раздражение' in emotion or 'недовольство' in emotion:
                tone_instruction = "Стиль резюме: нейтральный, но отметить недовольство клиента."
            elif 'любопытство' in emotion:
                tone_instruction = "Стиль резюме: нейтральный, отметить любопытство клиента."
            else:
                tone_instruction = "Стиль резюме: нейтральный, деловой."

            summary = call_mws_gpt([
                {
                    "role": "system",
                    "content": f"""
                        Ты {self.role}. {self.backstory}
                        {tone_instruction}
                        Сформируй краткое резюме обращения для CRM, включающее запрос, намерение, эмоцию, основной результат (ответ/инструкция), предпринятые действия, а также информацию о скидке или альтернативном сервисе, если они применимы.
                        Резюме должно быть не длиннее 2-3 предложений.
                        Если предложена скидка, укажи это в резюме (например, 'Предложена скидка 20%.').
                        Если запрошен недоступный сервис, упомяни предложенную альтернативу (например, 'Предложены альтернативы: {alternative_service or 'МТС Такси'}.').
                        Примеры:
                        - Запрос: 'не работает интернет' → 'Клиент выразил недовольство (жалоба) из-за неработающего интернета. Предоставлены инструкции по проверке настроек. Предложена скидка 20%.'
                        - Запрос: 'раздача интернета' → 'Клиент запросил инструкции по раздаче интернета (нейтрально). Предоставлены шаги для Android/iOS.'
                        - Запрос: 'хочу карпулинг как blablacar' → 'Клиент с любопытством запросил информацию о карпулинге. Проинформирован о недоступности сервиса. Предложены альтернативы: МТС Такси.'
                    """
                },
                {
                    "role": "user",
                    "content": f"""
                        Запрос: {actual_query}
                        Намерение: {intent}
                        Эмоция: {emotion}
                        Ответ/Результат: {reference_answer}
                        Действия оператора: {action}
                        Предложена скидка: {'Да' if is_discount_offered else 'Нет'} ({discount_details})
                        Предложен альтернативный сервис: {'Да' if is_alternative_offered else 'Нет'} ({alternative_service or 'Не применимо'})
                    """
                }
            ])
            shared_context['summary'] = summary # Update shared context
            return summary

        return self._log_and_measure_time(query, execution)
