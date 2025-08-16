"""
main.py — Runtime Settings + Optional Index Builder
- Centralizes settings (no Streamlit sidebar)
- Builds FAISS index if FAISS is available; otherwise prints a clear message
"""

import os, argparse, pickle, json
from typing import List, Optional

try:
    from dotenv import load_dotenv; load_dotenv()
except Exception:
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BROCHURE_PDF = os.path.join(BASE_DIR, "Company_Brochure.pdf")
DEFAULT_INDEX_PKL = os.path.join(BASE_DIR, "engagepro_index.pkl")
DEFAULT_INDEX_DIR = os.path.join(BASE_DIR, "engagepro_faiss")

# Imports
_FAISS_AVAILABLE = True
try:
    from langchain.text_splitter import RecursiveCharacterTextSplitter
    from langchain_community.vectorstores import FAISS
    from langchain_community.document_loaders import PyPDFLoader
    from langchain_community.docstore.document import Document
except Exception:
    _FAISS_AVAILABLE = False
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

# config.py
import config

def apply_runtime(args):
    if args.enable_wiki: os.environ["ENABLE_WIKI"] = "1"
    if args.disable_wiki: os.environ["ENABLE_WIKI"] = "0"
    if args.retriever_k is not None: os.environ["RETRIEVER_K"] = str(args.retriever_k)
    if args.chat_model: os.environ["OPENAI_CHAT_MODEL"] = args.chat_model
    if args.embed_model: os.environ["OPENAI_EMBED_MODEL"] = args.embed_model
    chat_model = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o")
    embed_model = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
    config.llm_openai = ChatOpenAI(model=chat_model, temperature=0.2)
    config.hf_embeddings = OpenAIEmbeddings(model=embed_model)
    print("[Bootstrap] Models:", json.dumps({"chat": chat_model, "embed": embed_model}))
    active = {
        "ENABLE_WIKI": os.getenv("ENABLE_WIKI", "1"),
        "RETRIEVER_K": os.getenv("RETRIEVER_K", "3"),
    }
    print("[Bootstrap] Settings:", json.dumps(active))

def make_index():
    if not _FAISS_AVAILABLE:
        print("[Index] FAISS is not installed. Skipping build. Install 'faiss-cpu' and rerun.")
        return False
    if not os.path.exists(BROCHURE_PDF):
        raise SystemExit(f"[Index] Missing {BROCHURE_PDF}")
    docs = PyPDFLoader(BROCHURE_PDF).load()
    chunks = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=120).split_documents(docs)
    vs = FAISS.from_documents(chunks, config.hf_embeddings)
    with open(DEFAULT_INDEX_PKL, "wb") as f: pickle.dump(vs, f)
    os.makedirs(DEFAULT_INDEX_DIR, exist_ok=True); vs.save_local(DEFAULT_INDEX_DIR)
    print(f"[Index] Saved Pickle → {DEFAULT_INDEX_PKL} and FAISS dir → {DEFAULT_INDEX_DIR}")
    return True

def main():
    p = argparse.ArgumentParser(description="Bootstrap + settings + optional index build")
    p.add_argument("--make-index", action="store_true")
    p.add_argument("--enable-wiki", dest="enable_wiki", action="store_true")
    p.add_argument("--disable-wiki", dest="disable_wiki", action="store_true")
    p.add_argument("--retriever-k", dest="retriever_k", type=int, default=None)
    p.add_argument("--chat-model", dest="chat_model", type=str, default=None)
    p.add_argument("--embed-model", dest="embed_model", type=str, default=None)
    args = p.parse_args()
    apply_runtime(args)
    if args.make_index: make_index()
    print("[Bootstrap] Done.")

if __name__ == "__main__":
    main()
