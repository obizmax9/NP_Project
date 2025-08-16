from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_community.embeddings import HuggingFaceInferenceAPIEmbeddings
import os
# from langchain_deepseek import ChatDeepSeek
from sentence_transformers import SentenceTransformer

# Load environment variables from .env file
load_dotenv()

# Optional: For Deepseek API
# DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API")
# llm_deepseek = ChatDeepSeek(model="...",temperature=0,max_tokens=None,timeout=None,max_retries=2,api_key=DEEPSEEK_API_KEY)

# Optional: For those running with Ollama
# from langchain_community.chat_models import ChatOllama
# from langchain_ollama import ChatOllama
# llm_ollama = ChatOllama(model="llama3")  

# Optional: For those with OpenAIAPI
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
llm_openai = ChatOpenAI(
    openai_api_key = OPENAI_API_KEY,
)

# Local LLM
# llm_local = ChatOpenAI(
#     api_key="NIL",
#     openai_api_base="http://localhost:1234/v1/",
# )

# Openrouter LLM
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
llm_open_router = ChatOpenAI(
    api_key=OPENROUTER_API_KEY,
    openai_api_base="https://openrouter.ai/api/v1/",
    model="mistralai/mistral-small-3.2-24b-instruct-2506:free",
)

# Postgres connection string
DATABASE_URL = os.environ.get("DATABASE_URL")

hf_embeddings = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

