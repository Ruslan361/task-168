# -*- coding: utf-8 -*-
"""
Configuration settings for the application
"""

import logging
import warnings
from bs4 import BeautifulSoup

# API Key for MWS GPT
API_KEY = "sk-KNo006G2a48UVE3IxFlQEQ"  # REPLACE WITH YOUR KEY

# Настройка логирования
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()
logger.handlers = []
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logger.addHandler(console_handler)

# Игнорируем предупреждение RuntimeWarning от BeautifulSoup
warnings.filterwarnings("ignore", category=RuntimeWarning, module="bs4")

# Default paths
DEFAULT_INDEX_PATH = "faiss_index.bin"
DEFAULT_KNOWLEDGE_BASE_PATH = "knowledge_base_with_b2c.csv"
DEFAULT_PROCESSED_JSON_PATH = "data/processed_articles.json"
DEFAULT_FAISS_INDEX_DIR = "./data/faiss_index"