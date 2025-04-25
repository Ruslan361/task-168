# -*- coding: utf-8 -*-
"""Action Advisor Agent implementation."""

from typing import Dict, Any, Tuple

from .base_agent import BaseMwsAgent
from .utils import call_mws_gpt

class ActionAdvisorAgent(BaseMwsAgent):
    """Agent responsible for advising on the next actions."""

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
            # discount_details = shared_context.get('discount_details', '') # Not directly used in prompt
            alternative_service = shared_context.get('alternative_service', '')
            is_confirmed_problem = shared_context.get('discount_offered', False)
            is_service_request = bool(alternative_service)

            tone_instruction = ""
            if 'раздражение' in emotion or 'недовольство' in emotion:
                tone_instruction = "Начни с фразы 'Мы понимаем ваше беспокойство' и используй эмпатичный, успокаивающий тон. Избегай сложного технического жаргона, объясняй просто."
            elif 'любопытство' in emotion:
                tone_instruction = "Используй информативный и вовлекающий тон. Начни с фразы 'Интересный вопрос!' и добавь дополнительные детали, если возможно."
            else:
                tone_instruction = "Используй четкий и деловой тон. Предоставляй точные инструкции без лишних деталей. Не добавляй эмоциональных фраз, таких как 'успокоить'."

            action = call_mws_gpt([
                {
                    "role": "system",
                        "content": f"""
                            Ты {self.role}. {self.backstory}
                            {tone_instruction}
                            Предложи действия для оператора на основе запроса, намерения, эталонного ответа, подтвержденной проблемы и запроса сервиса.
                            Действия должны быть конкретными, учитывать эмоции клиента и помогать решить проблему.
                            Для нейтральной эмоции избегай фраз вроде 'успокоить клиента', фокусируйся на предоставлении инструкций или уточнении.
                            Примеры:
                            - Намерение: 'жалоба', Эмоция: 'недовольство', Подтверждена проблема → '1. Успокоить клиента.\n2. Проверить настройки телефона.\n3. Предложить клиенту скидку 20% на следующий месяц услуг.'
                            - Намерение: 'запрос инструкции', Эмоция: 'нейтральная' → '1. Предоставить инструкции из ответа.\n2. Уточнить, нужна ли помощь.'
                            - Намерение: 'запрос информации', Эмоция: 'любопытство', Запрошен сервис → '1. Проинформировать клиента об альтернативных сервисах МТС, таких как МТС Такси.\n2. Предложить помощь с установкой приложения МТС Транспорт.'

                            Если подтверждена проблема (например, сбой приложения, списание средств), добавь действие: 'Предложить клиенту скидку 15% на следующий месяц услуг.' Скидка должна быть только в случае, когда МТС действительно виновата в неисправной работе какой-либо услгуи и только тогда, когда клиент действительно сильно расстроен и потерял много сил и времени на решение проблемы.
                            Пример:
                            - Запрос: 'не работает интернет' → 'Клиент выразил недовольство из-за неработающего интернета. Предоставлены инструкции. Предложена скидка 10% на следующий месяц услуг.'

                            Если запрошен недоступный сервис, то проанализируй что это за сервис и предложи альтернативу, которая есть у МТС. Добавь действие: 'Проинформировать клиента об альтернативных сервисах МТС, таких как {alternative_service}'
                            Форматируй ответ как нумерованный список.
                            Примеры:
                            - Запрос: 'хочу карпулинг как blablacar' → 'Клиент запросил информацию о карпулинге. Предложены альтернативные сервисы МТС, такие как МТС Такси.'
                        """
                    },
                {
                    "role": "user",
                    "content": f"""
                        Запрос: {actual_query}
                        Намерение: {intent}
                        Эмоция: {emotion}
                        Эталонный ответ: {reference_answer}
                        Подтвержденная проблема: {'Да' if is_confirmed_problem else 'Нет'}
                        Запрос сервиса: {'Да' if is_service_request else 'Нет'}
                        Альтернативный сервис: {alternative_service or 'Не применимо'}
                    """
                }
            ])
            shared_context['action'] = action # Update shared context
            return action

        return self._log_and_measure_time(query, execution)
