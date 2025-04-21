# -*- coding: utf-8 -*-
"""
Utility functions for the application
"""

import json
import requests
import time
from bs4 import BeautifulSoup
import pandas as pd
import os
import logging
from config import API_KEY

def call_mws_gpt(messages, model="mws-gpt-alpha", temperature=0.65, retries=3):
    """
    Synchronous function to call MWS GPT (chat)
    
    Args:
        messages (list): List of message objects
        model (str): Model name to use
        temperature (float): Temperature for generation
        retries (int): Number of retries
        
    Returns:
        str: Generated response
    """
    url = "https://api.gpt.mws.ru/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature
    }
    for attempt in range(retries):
        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            return data['choices'][0]['message']['content']
        except Exception as e:
            if attempt == retries - 1:
                logging.error(f"Ошибка MWS GPT (чат) после {retries} попыток: {str(e)}")
                raise
            time.sleep(1)

def get_mws_embeddings(texts, model="bge-m3", retries=3):
    """
    Synchronous function to get embeddings from MWS GPT
    
    Args:
        texts (str or list): Text or list of texts to embed
        model (str): Model name to use
        retries (int): Number of retries
        
    Returns:
        list: Embedding vector(s)
    """
    url = "https://api.gpt.mws.ru/v1/embeddings"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "input": texts if isinstance(texts, list) else [texts]
    }
    for attempt in range(retries):
        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            return [item['embedding'] for item in data['data']] if isinstance(texts, list) else data['data'][0]['embedding']
        except Exception as e:
            if attempt == retries - 1:
                logging.error(f"Ошибка MWS GPT (эмбеддинги) после {retries} попыток: {str(e)}")
                raise
            time.sleep(1)

def clean_html_content(html_content):
    """
    Clean HTML content
    
    Args:
        html_content (str): HTML content to clean
        
    Returns:
        str: Cleaned text
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    for ul in soup.find_all('ul'):
        for li in ul.find_all('li'):
            li.insert(0, "- ")
    return soup.get_text(separator="\n", strip=True)

def process_b2c_articles(json_files=["articles.json", "articles_b2c.json"], output_csv="knowledge_base_with_b2c.csv"):
    """
    Process B2C JSON files into knowledge base
    
    Args:
        json_files (list): List of JSON files to process
        output_csv (str): Output CSV file path
        
    Returns:
        DataFrame: Processed knowledge base
    """
    print("Обработка JSON-файлов для базы знаний...")
    b2c_data = []
    seen_ids = set()
    for json_path in json_files:
        if not os.path.exists(json_path):
            logging.warning(f"Файл {json_path} не найден, пропускаем...")
            continue
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                articles = json.load(f)
            for article in articles:
                article_id = article.get('id')
                if article_id in seen_ids:
                    continue
                seen_ids.add(article_id)
                query = article.get('name', '').strip().lower()
                content = article.get('content', '')
                source = article.get('urlArticleOnSupport', '')
                cleaned_content = clean_html_content(content)
                b2c_data.append({
                    'query': query,
                    'correct_answer': cleaned_content,
                    'correct_sources': source,
                    'article_id': article_id
                })
        except Exception as e:
            logging.error(f"Ошибка при обработке {json_path}: {str(e)}")
            continue
    if not b2c_data:
        logging.error("Не удалось загрузить данные из JSON-файлов. Создаем минимальную базу знаний.")
        b2c_data = [
            {
                'query': 'интернет',
                'correct_answer': 'Слишком широкий запрос. Возможно, вы имели в виду:\n- Как раздать интернет с телефона\n- Не работает мобильный интернет\n- Не работает домашний интернет',
                'correct_sources': '',
                'article_id': '1'
            },
            {
                'query': 'раздача интернета',
                'correct_answer': 'Для раздачи интернета включите режим модема в настройках телефона.\nКак включить режим модема на Android:\n1. Зайдите в Настройки\n2. В строке поиска введите запрос «модем»\n3. Выберите из результатов поиска Режим модема или Мобильная точка доступа и модем\n4. Нажмите на кнопку переключения в пункте, который может называться «Мобильная точка доступа», «Личная точка доступа» или «Точка доступа Wi-Fi»\nВ отдельном пункте вы можете задать пароль для защиты вашего соединения.\nКак включить режим модема на iOS:\n1. Зайдите в Настройки > Режим модема\n2. Нажмите кнопку переключения в пункте Разрешать другим\nВ отдельном пункте вы можете задать пароль для защиты вашего соединения.',
                'correct_sources': 'https://support.mts.ru/mts_mobilnyy_internet/razdacha-interneta/kak-razdat-internet-s-telefona',
                'article_id': '2'
            },
            {
                'query': 'куда пропали 120 рублей',
                'correct_answer': 'Мы понимаем ваше беспокойство. Чтобы выяснить, куда пропали 120 рублей, проверьте детализацию расходов в приложении Мой МТС или обратитесь в контактный центр по номеру 0890.',
                'correct_sources': 'https://support.mts.ru/pomoshch-po-balansu',
                'article_id': '3'
            },
            {
                'query': 'хочу карпулинг как blablacar',
                'correct_answer': 'К сожалению, сервис карпулинга, подобный BlaBlaCar, сейчас недоступен в МТС. Вы можете воспользоваться другими транспортными решениями МТС, такими как МТС Такси или аренда электросамокатов через партнерские сервисы. Для заказа поездки скачайте приложение МТС Транспорт.',
                'correct_sources': 'https://mts.ru/transport',
                'article_id': '4'
            },
            {
                'query': 'приложение не работает списали деньги',
                'correct_answer': 'Мы понимаем ваше беспокойство. Если приложение МТС не работает и с вашего счета были списаны деньги, проверьте детализацию расходов в приложении Мой МТС или обратитесь в контактный центр по номеру 0890 для уточнения и решения проблемы.',
                'correct_sources': 'https://support.mts.ru/pomoshch-po-balansu',
                'article_id': '5'
            }
        ]
    b2c_df = pd.DataFrame(b2c_data)
    b2c_df = b2c_df.dropna(subset=['query', 'correct_answer'])
    b2c_df.loc[:, 'query'] = b2c_df['query'].str.strip().str.lower()
    b2c_df.loc[:, 'correct_answer'] = b2c_df['correct_answer'].str.strip()
    b2c_df.loc[:, 'correct_sources'] = b2c_df['correct_sources'].fillna('')
    b2c_df.loc[:, 'article_id'] = b2c_df['article_id'].fillna(-1)
    b2c_df = b2c_df.drop_duplicates(subset=['query'], keep='first')
    b2c_df.to_csv(output_csv, index=False, encoding='utf-8')
    print(f"Создана база знаний: {len(b2c_df)} записей")
    logging.info(f"Создана база знаний: {len(b2c_df)} записей")
    logging.info("Примеры запросов в базе знаний:")
    logging.info(b2c_df[['query', 'correct_answer']].head().to_string())
    return b2c_df

def load_knowledge_base(file_path="knowledge_base_with_b2c.csv"):
    """
    Load knowledge base from CSV file
    
    Args:
        file_path (str): Path to CSV file
        
    Returns:
        DataFrame: Loaded knowledge base
    """
    print(f"Загрузка базы знаний из {file_path}...")
    try:
        df = pd.read_csv(file_path, encoding='utf-8')
        df = df.dropna(subset=['query', 'correct_answer']).copy()
        df.loc[:, 'query'] = df['query'].str.strip().str.lower()
        df.loc[:, 'correct_answer'] = df['correct_answer'].str.strip()
        df.loc[:, 'correct_sources'] = df['correct_sources'].fillna('')
        print(f"База знаний загружена: {len(df)} записей")
        return df
    except FileNotFoundError:
        logging.error(f"Файл {file_path} не найден")
        raise
    except Exception as e:
        logging.error(f"Ошибка при загрузке базы знаний: {str(e)}")
        raise