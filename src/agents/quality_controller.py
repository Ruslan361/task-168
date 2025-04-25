# -*- coding: utf-8 -*-
"""Quality Controller Agent implementation."""

from typing import Dict, Any, Tuple

from .base_agent import BaseMwsAgent
from .utils import call_mws_gpt

class QualityControllerAgent(BaseMwsAgent):
    """Agent responsible for controlling the quality of the response."""

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
            user_answer = shared_context.get('question', '') # User answer provided for comparison
            reference_answer = shared_context.get('reference_answer', '')
            summary = shared_context.get('summary', '') # Summary might be useful context for QA
            # discount_details = shared_context.get('discount_details', '') # Use boolean flags instead
            # alternative_service = shared_context.get('alternative_service', '') # Use boolean flags instead
            is_discount_offered_context = shared_context.get('discount_offered', False)
            is_alternative_offered_context = bool(shared_context.get('alternative_service', ''))
            is_confirmed_problem_context = shared_context.get('intent', '') == 'жалоба' and emotion == 'недовольство' # Re-check condition for discount necessity


            inappropriate_phrases = ['глупый', 'дурацкий', 'идиот', 'бред', 'не смеши']
            is_inappropriate = any(phrase in user_answer.lower() for phrase in inappropriate_phrases)

            # Basic check if user_answer is empty
            if not user_answer.strip():
                 return "Не соответствует: Ответ сотрудника пустой."

            qa_result = call_mws_gpt([
                {
                    "role": "system",
                    "content": f"""
                        Ты {self.role}. {self.backstory}
                        Проверь, соответствует ли ответ сотрудника стандартам общения МТС и Кодексу делового поведения и этики Группы МТС, учитывая эмоции клиента ({emotion}).
                        Стандарты МТС:
                        - Для 'недовольства': ответ эмпатичный, содержит слова 'понимаем', 'беспокойство', 'извините'. Если подтверждена проблема (жалоба + недовольство), должен предлагаться промокод на скидку 20%.
                        - Для 'нейтральной': ответ четкий, деловой, без лишних эмоций, строго соответствует базе знаний.
                        - Для 'любопытства': ответ информативный, с дополнительными деталями. Если запрошен недоступный сервис, предлагается альтернатива (например, МТС Такси).
                        - Ответ структурирован (списки, заголовки), не содержит лишних деталей.
                        Требования Кодекса делового поведения и этики МТС:
                        - Этичность: ответ честный, справедливый, не вводит в заблуждение, не содержит неуважительных или оскорбительных фраз. (#Вместе)
                        - Клиентоориентированность: решает задачу клиента, превышает ожидания (#ПроКлиента).
                        - Профессионализм: структурирован, емкий, предметный (#БыстроПосути).
                        - Конфиденциальность: не раскрывает персональные данные.
                        - Проактивность: предлагает решения (#БериДействуй, #СделайКруто).
                        - Уважение: учитывает эмоции клиента, без дискриминации (#Вместе).

                        Оценка:
                        1.  **Неуважительные фразы:** Если ответ содержит неуважительные фразы ({', '.join(inappropriate_phrases)}), он автоматически 'Не соответствует'. Укажи на нарушение #Вместе, #ПроКлиента.
                        2.  **Соответствие тону:** Проверь соответствие тона ответа эмоции клиента ('эмпатичный' для недовольства, 'деловой' для нейтральной, 'информативный' для любопытства).
                        3.  **Соответствие базе знаний:** Сравни ответ сотрудника с эталонным ответом. Насколько точно передана информация? Нет ли лишних или пропущенных деталей?
                        4.  **Скидка:** Если была подтвержденная проблема (жалоба + недовольство), проверь, предложена ли скидка 20% в ответе сотрудника.
                        5.  **Альтернатива:** Если был запрос недоступного сервиса, проверь, предложена ли альтернатива в ответе сотрудника.
                        6.  **Структура и Кодекс:** Оцени структуру (списки, ясность) и общую этичность, профессионализм, проактивность (#БыстроПосути, #ПроКлиента, #БериДействуй).

                        Верни оценку: 'Соответствует' или 'Не соответствует' с кратким пояснением по пунктам 1-6. Если 'Не соответствует', предложи 1-2 конкретные корректирующие меры.

                        Эталонный ответ для сравнения: {reference_answer}
                        Была ли подтвержденная проблема (требующая скидки): {'Да' if is_confirmed_problem_context else 'Нет'}
                        Был ли запрос недоступного сервиса (требующий альтернативы): {'Да' if is_alternative_offered_context else 'Нет'}
                    """
                },
                {
                    "role": "user",
                    "content": f"""
                        Запрос клиента: {actual_query}
                        Эмоция клиента: {emotion}
                        Ответ сотрудника: {user_answer}
                        Проверка на неуважительные фразы: {'Обнаружены' if is_inappropriate else 'Не обнаружены'}
                    """
                }
            ])

            # Override if inappropriate phrases were detected by simple check
            if is_inappropriate:
                qa_result = (
                    "Не соответствует: Ответ содержит неуважительную фразу. Нарушены принципы #Вместе, #ПроКлиента. "
                    "Рекомендация: Пройти тренинг по Кодексу делового поведения и этики МТС."
                )

            shared_context['qa'] = qa_result # Update shared context
            return qa_result

        return self._log_and_measure_time(query, execution)
